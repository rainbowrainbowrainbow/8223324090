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
let roomData = null; // deprecated — Room tab removed
let questsData = null;
let titlesData = null;
let shopItems = [];
let leaderboardData = null;
let achCatFilter = 'all';
let leaderboardSort = 'xp';
let activeTab = 'profile';
let myCabinetData = null;
let myTasksSegment = 'all';
let cabinetPulseCounts = { alerts: 0, funnel: 0 };
let profileSecurityData = null;

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
        art_director: 'Арт директор'
    };
    return labels[role] || role || 'Працівник';
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
const PROFILE_AVATAR_EMOJIS = ['🙂', '😎', '🤝', '🧠', '⚡', '🔥', '🎯', '✅', '💼', '🛠️', '🎨', '👑'];
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
    return `<div class="${className}"${style}${attrs}>${escapeHtml(avatar.emoji || avatar.initial)}</div>`;
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
        return await r.json();
    } catch (e) { console.error('API POST', path, e); return null; }
}

async function apiPut(path, body) {
    try {
        const r = await fetch(`/api${path}`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(body) });
        if (handleAuthError(r)) return null;
        return await r.json();
    } catch (e) { console.error('API PUT', path, e); return null; }
}

async function apiPatch(path, body) {
    try {
        const r = await fetch(`/api${path}`, { method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify(body) });
        if (handleAuthError(r)) return null;
        return await r.json();
    } catch (e) { console.error('API PATCH', path, e); return null; }
}

async function apiDelete(path) {
    try {
        const r = await fetch(`/api${path}`, { method: 'DELETE', headers: getAuthHeaders(false) });
        if (handleAuthError(r)) return null;
        return await r.json();
    } catch (e) { console.error('API DELETE', path, e); return null; }
}

// ==========================================
// PAGE INIT
// ==========================================
async function initProfilePage() {
    // Dark mode
    if (localStorage.getItem('pzp_dark_mode') === 'true') {
        document.body.classList.add('dark-mode');
    }

    const token = localStorage.getItem('pzp_token');
    if (!token) { window.location.href = '/'; return; }

    // Get current user
    try {
        const r = await fetch('/api/auth/verify', { headers: getAuthHeaders(false) });
        if (!r.ok) { window.location.href = '/'; return; }
        const data = await r.json();
        const user = data.user || data;
        if (typeof AppState !== 'undefined') AppState.currentUser = user;
        currentUserId = user.id;
    } catch (e) { window.location.href = '/'; return; }

    // Check URL for user ID
    const params = new URLSearchParams(window.location.search);
    const viewUserId = parseInt(params.get('id')) || currentUserId;
    isOwnProfile = viewUserId === currentUserId;
    const requestedTab = params.get('tab');
    const allowedOwnTabs = ['profile', 'myday', 'mytasks', 'settings', 'achievements', 'inventory', 'shop', 'leaderboard', 'quests', 'season', 'teams', 'referral'];
    if (isOwnProfile && requestedTab && allowedOwnTabs.includes(requestedTab)) {
        activeTab = requestedTab;
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
        null, // room removed
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
    roomData = results[5];
    questsData = results[6];
    titlesData = results[7];
    allStreaks = results[8];
    myCabinetData = results[9];
    syncCabinetPulseCounts(results[10], results[11]);
    profileSecurityData = results[12];
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
    const completedAch = myAchievements.filter(a => a.completed);
    const totalAch = myAchievements.filter(a => !a.isSecret || a.completed).length;
    const activeTasks = Number(p.tasks?.assigned || 0) + Number(p.tasks?.in_progress || 0);
    const overdueTasks = Number(p.tasks?.overdue || 0);
    const doneToday = Number(p.dayProgress?.tasksDoneToday || 0);
    const remainingToday = Number(p.dayProgress?.tasksRemaining || 0);
    const shift = p.todayShift;
    const shiftLabel = shift
        ? `${escapeHtml(shift.start || '')}${shift.end ? ' - ' + escapeHtml(shift.end) : ''}`
        : 'Сьогодні без зміни';

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
                    <div class="profile-role-line">
                        <span>${escapeHtml(roleLabel)}</span>
                        ${username ? `<span>@${escapeHtml(username)}</span>` : ''}
                        <span class="${p.user?.telegramConnected ? 'is-ok' : ''}">${p.user?.telegramConnected ? 'Telegram підключено' : 'Telegram не підключено'}</span>
                    </div>
                    ${titleHtml ? `<div class="profile-title-row">${titleHtml}</div>` : ''}
                    ${p.user?.bio || p.bio ? `<div class="profile-bio">${escapeHtml(p.user?.bio || p.bio)}</div>` : ''}
                </div>
            </div>

            <div class="profile-work-summary">
                <div class="profile-work-stat ${overdueTasks > 0 ? 'danger' : ''}">
                    <b>${activeTasks}</b>
                    <span>активних задач</span>
                </div>
                <div class="profile-work-stat">
                    <b>${doneToday}/${doneToday + remainingToday}</b>
                    <span>сьогодні</span>
                </div>
                <div class="profile-work-stat">
                    <b>${completedAch.length}/${totalAch || 0}</b>
                    <span>досягнення</span>
                </div>
                <div class="profile-work-stat wide">
                    <b>${shiftLabel}</b>
                    <span>${shift?.department || shift?.position || 'робочий графік'}</span>
                </div>
            </div>
        </div>

        <!-- TABS -->
        <div class="profile-primary-tabs profile-work-tabs" role="tablist" aria-label="Розділи профілю">
            <button class="profile-primary-tab ${activeTab === 'profile' ? 'active' : ''}" onclick="switchTab('profile')">Огляд</button>
            ${isOwnProfile ? `<button class="profile-primary-tab ${activeTab === 'myday' ? 'active' : ''}" onclick="switchTab('myday')">Мій день</button>` : ''}
            ${isOwnProfile ? `<button class="profile-primary-tab ${activeTab === 'mytasks' ? 'active' : ''}" onclick="switchTab('mytasks')">Мої задачі</button>` : ''}
            ${isOwnProfile ? `<button class="profile-primary-tab ${activeTab === 'settings' ? 'active' : ''}" onclick="switchTab('settings')">Налаштування</button>` : ''}
            <button class="profile-primary-tab ${activeTab === 'achievements' ? 'active' : ''}" onclick="switchTab('achievements')">Досягнення</button>
            ${isOwnProfile ? `<button class="profile-primary-tab ${activeTab === 'inventory' ? 'active' : ''}" onclick="switchTab('inventory')">Інвентар</button>` : ''}
            ${isOwnProfile ? `<button class="profile-primary-tab ${activeTab === 'shop' ? 'active' : ''}" onclick="switchTab('shop')">Магазин</button>` : ''}
            <button class="profile-primary-tab ${activeTab === 'leaderboard' ? 'active' : ''}" onclick="switchTab('leaderboard')">Рейтинг</button>
            ${isOwnProfile ? `<button class="profile-primary-tab ${activeTab === 'quests' ? 'active' : ''}" onclick="switchTab('quests')">Щоденні${_hasUnclaimedQuests() ? '<span class="profile-reward-dot" aria-label="Є нагороди"></span>' : ''}</button>` : ''}
            <button class="profile-primary-tab ${activeTab === 'season' ? 'active' : ''}" onclick="switchTab('season')">Сезон</button>
            <button class="profile-primary-tab ${activeTab === 'teams' ? 'active' : ''}" onclick="switchTab('teams')">Команди</button>
            ${isOwnProfile ? `<button class="profile-primary-tab ${activeTab === 'referral' ? 'active' : ''}" onclick="switchTab('referral')">Реферали</button>` : ''}
        </div>

        <div id="tabContent">
            ${renderTabContent()}
        </div>
    </div>`;

    document.getElementById('main-content').innerHTML = html;
    attachProfileListeners();
}

async function switchTab(tab) {
    activeTab = tab;
    if (tab === 'mytasks') {
        setCabinetQuickMode('tasks');
    }
    if (isOwnProfile && (tab === 'myday' || tab === 'mytasks') && !myCabinetData) {
        myCabinetData = await apiGet('/tasks/my-cabinet');
    }
    if (isOwnProfile && (tab === 'myday' || tab === 'mytasks')) {
        await refreshCabinetPulseCounts();
    }

    // Lazy load data for tabs that need it
    if (tab === 'shop' && shopItems.length === 0) await loadShopItems();
    if (tab === 'leaderboard' && !leaderboardData) await loadLeaderboard();
    if (tab === 'season' && !seasonalQuests) await loadSeasonalQuests();
    if (tab === 'teams' && !teamsData) await loadTeamsData();
    if (tab === 'referral' && !referralData) await loadReferralData();

    const tabContent = document.getElementById('tabContent');
    if (tabContent) {
        tabContent.innerHTML = renderTabContent();
        attachProfileListeners();
    }
    // Update tab buttons
    document.querySelectorAll('.profile-primary-tab').forEach(btn => {
        const tabName = btn.getAttribute('onclick')?.match(/switchTab\('(\w+)'\)/)?.[1];
        btn.classList.toggle('active', tabName === tab);
    });
}

function renderTabContent() {
    switch (activeTab) {
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
        default: return renderWorkProfileOverview();
    }
}

function renderWorkProfileOverview() {
    const p = profileData || {};
    const tasks = p.tasks || {};
    const day = p.dayProgress || {};
    const shift = p.todayShift;
    const myTasks = Array.isArray(p.myTasks) ? p.myTasks : [];
    const overdue = Array.isArray(tasks.overdueList) ? tasks.overdueList : [];
    const upcoming = Array.isArray(tasks.upcoming) ? tasks.upcoming : [];
    const recentActivity = Array.isArray(p.recentActivity) ? p.recentActivity.slice(0, 6) : [];
    const pointTotal = p.points?.permanentTotal || p.points?.permanentThisMonth || walletData?.coins || 0;
    const streakCurrent = p.streak?.current || p.currentStreak || 0;
    const completedToday = Number(day.tasksDoneToday || 0);
    const remainingToday = Number(day.tasksRemaining || 0);

    return `
        <div class="profile-work-overview">
            <section class="profile-work-panel profile-work-panel-primary">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Сьогодні</span>
                        <h2>Робочий стан</h2>
                    </div>
                    <a href="/tasks?view=today">Відкрити задачі</a>
                </div>
                <div class="profile-status-grid">
                    ${profileOverviewMetric('Задачі сьогодні', `${completedToday}/${completedToday + remainingToday}`, 'закрито / всього')}
                    ${profileOverviewMetric('У роботі', Number(tasks.in_progress || 0), 'активний execution')}
                    ${profileOverviewMetric('Прострочено', Number(tasks.overdue || 0), 'потребує уваги', Number(tasks.overdue || 0) > 0 ? 'danger' : 'ok')}
                    ${profileOverviewMetric('Зміна', shift ? `${shift.start || ''}${shift.end ? ' - ' + shift.end : ''}` : 'Без зміни', shift?.position || shift?.department || 'графік')}
                </div>
            </section>

            <section class="profile-work-panel">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Execution</span>
                        <h2>Мої активні задачі</h2>
                    </div>
                    <span>${myTasks.length}</span>
                </div>
                ${myTasks.length
                    ? `<div class="profile-work-list">${myTasks.slice(0, 6).map(renderProfileTaskRow).join('')}</div>`
                    : '<div class="profile-empty-professional">Активних задач немає.</div>'}
            </section>

            <section class="profile-work-panel">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Контроль</span>
                        <h2>Ризики й дедлайни</h2>
                    </div>
                    <span>${overdue.length + upcoming.length}</span>
                </div>
                ${overdue.length || upcoming.length
                    ? `<div class="profile-work-list">
                        ${overdue.slice(0, 4).map(task => renderProfileTaskRow(task, 'Прострочено')).join('')}
                        ${upcoming.slice(0, 4).map(task => renderProfileTaskRow(task, 'Скоро')).join('')}
                    </div>`
                    : '<div class="profile-empty-professional">Критичних дедлайнів поруч немає.</div>'}
            </section>

            <section class="profile-work-panel profile-work-panel-compact">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Поведінка</span>
                        <h2>Прогрес</h2>
                    </div>
                </div>
                <div class="profile-compact-metrics">
                    ${profileOverviewMetric('Баланс', formatCoins(pointTotal), 'внутрішні бали')}
                    ${profileOverviewMetric('Streak', streakCurrent, 'днів активності')}
                    ${profileOverviewMetric('Бронювання', Number(p.bookings?.total || 0), 'створено')}
                </div>
            </section>

            <section class="profile-work-panel profile-work-panel-compact">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Audit</span>
                        <h2>Остання активність</h2>
                    </div>
                </div>
                ${recentActivity.length
                    ? `<div class="profile-activity-compact">${recentActivity.map(renderProfileActivityRow).join('')}</div>`
                    : '<div class="profile-empty-professional">Активності ще немає.</div>'}
            </section>

        </div>`;
}

function renderProfileSettingsTab() {
    const avatar = profileAvatarData(profileData);
    const currentEmoji = avatar.emoji || '🙂';
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
                            ${avatar.url ? `<img src="${escapeHtml(avatar.url)}" alt="">` : escapeHtml(avatar.emoji || avatar.initial)}
                        </div>
                        <div class="profile-avatar-preview-hint">Так аватарка буде виглядати в меню та профілі</div>
                    </div>
                    <div class="profile-avatar-controls">
                        <input type="hidden" id="profileAvatarEmoji" value="${escapeHtml(currentEmoji)}">
                        <input type="hidden" id="profileAvatarColor" value="${escapeHtml(currentColor)}">
                        <label>Швидкий emoji</label>
                        <div class="profile-avatar-emoji-grid">
                            ${PROFILE_AVATAR_EMOJIS.map(emoji => `<button type="button" class="${emoji === currentEmoji ? 'active' : ''}" onclick="selectProfileAvatarEmoji('${emoji}')">${escapeHtml(emoji)}</button>`).join('')}
                        </div>
                        <label>Колір фону</label>
                        <div class="profile-avatar-color-grid">
                            ${PROFILE_AVATAR_COLORS.map(color => `<button type="button" class="${color.toLowerCase() === currentColor.toLowerCase() ? 'active' : ''}" style="background:${color}" title="${color}" onclick="selectProfileAvatarColor('${color}')"></button>`).join('')}
                        </div>
                        <div class="profile-avatar-action-row">
                            <button type="button" class="profile-settings-primary" onclick="saveProfileAvatar('emoji')">Зберегти emoji</button>
                            <button type="button" onclick="saveProfileAvatar('initials')">Літера з імені</button>
                        </div>
                        <label for="profileAvatarFile">Фото з компʼютера або телефона</label>
                        <div class="profile-avatar-upload-row">
                            <input id="profileAvatarFile" class="profile-avatar-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onchange="handleProfileAvatarFileChange(this)">
                            <label class="profile-avatar-file-pick" for="profileAvatarFile">
                                <span>⬆</span>
                                <b id="profileAvatarFileName">Обрати фото</b>
                                <small>JPG, PNG, WebP або GIF до 5 МБ</small>
                            </label>
                            <button type="button" id="profileAvatarUploadBtn" onclick="uploadProfileAvatarFile()" disabled>Завантажити</button>
                        </div>
                        <label for="profileAvatarUrl">Фото через URL</label>
                        <div class="profile-avatar-url-row">
                            <input id="profileAvatarUrl" type="url" placeholder="https://.../avatar.jpg" value="${escapeHtml(avatar.url)}" oninput="previewProfileAvatarUrl()">
                            <button type="button" onclick="saveProfileAvatar('image')">Зберегти фото</button>
                        </div>
                        <p class="profile-avatar-note">Можна завантажити файл із пристрою, вставити прямий https/http URL або використати emoji-аватар. Після збереження sidebar оновиться одразу.</p>
                    </div>
                </div>
            </section>
            ${renderProfileSecurityPanel()}
        </div>`;
}

function renderProfileSecurityPanel() {
    const security = profileSecurityData || {};
    const user = security.user || profileUser(profileData);
    const sessions = Array.isArray(security.sessions) ? security.sessions : [];
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
                <span>${sessions.length} активн${sessions.length === 1 ? 'а' : 'их'} сес${sessions.length === 1 ? 'ія' : 'ій'}</span>
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
                        <b>Активні сесії</b>
                        <span>refresh-token контур</span>
                    </div>
                    ${sessions.length
                        ? sessions.map(renderProfileSessionRow).join('')
                        : '<div class="profile-security-empty">Активні refresh-сесії не знайдено. Поточний legacy-вхід завершиться після logout або завершення JWT.</div>'}
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

function sessionDeviceLabel(session) {
    const device = String(session.device_info || session.deviceInfo || '').trim();
    if (!device) return 'Невідомий пристрій';
    if (/iPhone|iPad|Android/i.test(device)) return 'Мобільний браузер';
    if (/Windows/i.test(device)) return 'Windows браузер';
    if (/Mac OS|Macintosh/i.test(device)) return 'Mac браузер';
    return device.slice(0, 80);
}

function renderProfileSessionRow(session) {
    const ip = session.ip_address || session.ipAddress || 'IP не зафіксовано';
    return `
        <div class="profile-security-row">
            <div>
                <b>${escapeHtml(sessionDeviceLabel(session))}</b>
                <span>${escapeHtml(ip)}</span>
            </div>
            <small>${profileFormatTime(session.created_at || session.createdAt)} → ${profileFormatTime(session.expires_at || session.expiresAt)}</small>
        </div>`;
}

function accountSecurityEventLabel(type) {
    const labels = {
        password_changed: 'Пароль змінено',
        password_reset_by_admin: 'Пароль скинуто адміністратором',
        sessions_revoked: 'Сесії відкликано',
        account_created: 'Акаунт створено',
        account_profile_updated: 'Профіль акаунта змінено',
        account_roles_updated: 'Ролі змінено',
        account_activated: 'Акаунт активовано',
        account_deactivated: 'Акаунт деактивовано'
    };
    return labels[type] || type || 'Подія акаунта';
}

function renderProfileSecurityEventRow(event) {
    const actor = event.actor_username || event.actorUsername || 'CRM';
    const reason = event.reason || '';
    return `
        <div class="profile-security-row">
            <div>
                <b>${escapeHtml(accountSecurityEventLabel(event.event_type || event.eventType))}</b>
                <span>${escapeHtml(actor)}${reason ? ' · ' + escapeHtml(reason) : ''}</span>
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

function paintProfileAvatarPreview(mode = 'emoji') {
    const preview = document.getElementById('profileAvatarPreview');
    if (!preview) return;
    const emoji = document.getElementById('profileAvatarEmoji')?.value || profileAvatarData().initial;
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
    preview.textContent = mode === 'initials' ? profileAvatarData().initial : emoji;
}

function selectProfileAvatarEmoji(emoji) {
    const input = document.getElementById('profileAvatarEmoji');
    if (input) input.value = emoji;
    document.querySelectorAll('.profile-avatar-emoji-grid button').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.trim() === emoji);
    });
    paintProfileAvatarPreview('emoji');
}

function selectProfileAvatarColor(color) {
    const input = document.getElementById('profileAvatarColor');
    if (input) input.value = color;
    document.querySelectorAll('.profile-avatar-color-grid button').forEach(btn => {
        btn.classList.toggle('active', (btn.getAttribute('title') || '').toLowerCase() === color.toLowerCase());
    });
    paintProfileAvatarPreview('emoji');
}

function previewProfileAvatarUrl() {
    const url = String(document.getElementById('profileAvatarUrl')?.value || '').trim();
    paintProfileAvatarPreview(url ? 'image' : 'emoji');
}

function handleProfileAvatarFileChange(input) {
    const file = input?.files?.[0];
    const nameEl = document.getElementById('profileAvatarFileName');
    const uploadBtn = document.getElementById('profileAvatarUploadBtn');
    if (uploadBtn) uploadBtn.disabled = true;
    if (!file) {
        if (nameEl) nameEl.textContent = 'Обрати фото';
        return;
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (file.size > 5 * 1024 * 1024) {
        if (typeof showNotification === 'function') showNotification('Фото профілю має бути до 5 МБ', 'error');
        input.value = '';
        if (nameEl) nameEl.textContent = 'Обрати фото';
        return;
    }
    if (file.type && !allowed.includes(file.type)) {
        if (typeof showNotification === 'function') showNotification('Підтримуються тільки JPG, PNG, WebP або GIF', 'error');
        input.value = '';
        if (nameEl) nameEl.textContent = 'Обрати фото';
        return;
    }

    if (nameEl) nameEl.textContent = file.name;
    if (uploadBtn) uploadBtn.disabled = false;

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
        avatarEmoji: document.getElementById('profileAvatarEmoji')?.value || '🙂',
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
    const stats = myCabinetData?.stats || {};
    const tasksCount = Number(stats.todayPlanned || stats.openCount || cabinetList('all').length || 0);
    const alertsCount = cabinetPulseCounts.alerts;
    const funnelCount = cabinetPulseCounts.funnel;
    const activeMode = getCabinetQuickMode();
    const items = [
        {
            id: 'tasks',
            label: '\u0417\u0430\u0434\u0430\u0447\u0456',
            count: formatCabinetPulseCount(tasksCount),
            tone: tasksCount > 0 ? 'live' : 'zero',
            action: "switchTab('mytasks')"
        },
        {
            id: 'alerts',
            label: '\u0410\u043b\u0435\u0440\u0442\u0438',
            count: formatCabinetPulseCount(alertsCount),
            tone: alertsCount >= 10 ? 'critical' : alertsCount > 0 ? 'hot' : 'zero',
            action: 'openCabinetAlerts(event)'
        },
        {
            id: 'funnel',
            label: '\u0412\u043e\u0440\u043e\u043d\u043a\u0430',
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
            ' title="' + escapeHtml(item.label) + ': ' + item.count + '"',
            ' onclick="syncCabinetQuickMode(\'' + item.id + '\'); ' + item.action + '">',
            '<span class="cabinet-quick-plate"></span>',
            '<span class="cabinet-quick-body">',
            '<span class="cabinet-quick-label">' + escapeHtml(item.label) + '</span>',
            '<span class="cabinet-quick-count">' + item.count + '</span>',
            '</span>',
            '</button>'
        ].join('');
    }).join('');
    return '<div class="cabinet-quick-cluster" role="tablist" aria-label="\u0428\u0432\u0438\u0434\u043a\u0438\u0439 \u0432\u0438\u0431\u0456\u0440 \u0440\u043e\u0431\u043e\u0447\u043e\u0433\u043e \u0440\u0435\u0436\u0438\u043c\u0443 My Cabinet">' + segmentsHtml + '</div>';
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
    const mode = task?.taskMode || task?.task_mode || 'work';
    return { work: 'Робоча', personal: 'Особиста', private: 'Приватна', system: 'Системна' }[mode] || mode;
}

function taskKindLabel(task) {
    const kind = task?.taskKind || task?.task_kind || 'action';
    return {
        action: 'Дія',
        reminder: 'Нагадування',
        followup: 'Follow-up',
        deep_work: 'Deep work',
        checklist: 'Checklist',
        routine: 'Рутина',
        waiting: 'Чекаю',
        idea: 'Ідея',
        decision: 'Рішення'
    }[kind] || kind;
}

function renderCabinetTaskCard(task, compact = false) {
    const taskId = Number(task.id || task.taskId || task.task_id || 0);
    const taskIdAttr = Number.isInteger(taskId) && taskId > 0 ? String(taskId) : '';
    const due = task.scheduledStartAt || task.scheduled_start_at || task.schedule?.startAt || task.deadline || task.remindAt || task.remind_at || task.date;
    const scheduleStatus = task.scheduleStatus || task.schedule_status || task.schedule?.status || '';
    const subDone = Number(task.subtask_done_count || task.subtaskDoneCount || 0);
    const subTotal = Number(task.subtask_count || task.subtaskCount || 0);
    const doneActionLabel = 'Виконати задачу';
    const snoozeActionLabel = 'Відкласти задачу на 60 хвилин';
    const openActionLabel = 'Відкрити задачу у повному списку';
    return `
        <div class="cabinet-task-card">
            <div class="cabinet-task-main">
                <div class="cabinet-task-title">${escapeHtml(task.title || 'Без назви')}</div>
                <div class="cabinet-task-meta">
                    <span>${taskModeLabel(task)}</span>
                    <span>${taskKindLabel(task)}</span>
                    ${due ? `<span>${formatDate(due)}</span>` : ''}
                    ${scheduleStatus === 'proposal' ? '<span>потрібне підтвердження часу</span>' : ''}
                    ${scheduleStatus === 'missed' ? '<span>слот пропущено</span>' : ''}
                    ${subTotal ? `<span>${subDone}/${subTotal}</span>` : ''}
                </div>
            </div>
            <div class="cabinet-task-actions">
                <button type="button" class="cabinet-task-action-btn cabinet-task-action-done" title="${escapeHtml(doneActionLabel)}" aria-label="${escapeHtml(doneActionLabel)}" data-tooltip="${escapeHtml(doneActionLabel)}" data-cabinet-task-action="done" data-task-id="${taskIdAttr}" ${taskIdAttr ? '' : 'disabled'}>✓</button>
                ${compact ? '' : `<button type="button" class="cabinet-task-action-btn" title="${escapeHtml(snoozeActionLabel)}" aria-label="${escapeHtml(snoozeActionLabel)}" data-tooltip="${escapeHtml(snoozeActionLabel)}" data-cabinet-task-action="snooze" data-task-id="${taskIdAttr}" data-minutes="60" ${taskIdAttr ? '' : 'disabled'}>⏰</button>`}
                <button type="button" class="cabinet-task-action-btn" title="${escapeHtml(openActionLabel)}" aria-label="${escapeHtml(openActionLabel)}" data-tooltip="${escapeHtml(openActionLabel)}" data-cabinet-task-action="open" data-task-id="${taskIdAttr}" ${taskIdAttr ? '' : 'disabled'}>↗</button>
            </div>
        </div>`;
}

function renderCabinetSection(title, list, emptyText, compact = false) {
    return `
        <section class="cabinet-task-section">
            <div class="cabinet-section-head">
                <h3>${escapeHtml(title)}</h3>
                <span>${list.length}</span>
            </div>
            ${list.length
                ? list.map(task => renderCabinetTaskCard(task, compact)).join('')
                : `<div class="cabinet-empty">${escapeHtml(emptyText)}</div>`}
        </section>`;
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
                    <div class="cabinet-kicker">Personal command center</div>
                    <h2>Мій день</h2>
                    <p>Сьогоднішні, приватні задачі й короткий review без шуму повного board.</p>
                </div>
            </div>
            ${renderCabinetPulseCluster()}
            <form class="cabinet-capture" onsubmit="createCabinetTask(event, 'personal')">
                <input id="cabinetTaskTitle" placeholder="Швидко зафіксувати задачу собі">
                <select id="cabinetTaskKind">
                    <option value="action">Дія</option>
                    <option value="reminder">Нагадування</option>
                    <option value="followup">Follow-up</option>
                    <option value="deep_work">Deep work</option>
                    <option value="waiting">Чекаю</option>
                    <option value="idea">Ідея</option>
                </select>
                <button type="submit">Додати</button>
                <button type="button" onclick="createCabinetTask(event, 'private')">Приватна</button>
            </form>
            <div class="cabinet-grid">
                ${renderCabinetSection('Сьогодні', today, 'На сьогодні немає активних задач.')}
                ${renderCabinetSection('Прострочено', overdue, 'Немає прострочених задач.', true)}
                ${renderCabinetSection('Чекаю', waiting, 'Нічого не зависло в очікуванні.', true)}
                ${renderCabinetSection('Приватне', privateTasks, 'Приватний шар порожній.', true)}
                <section class="cabinet-task-section">
                    <div class="cabinet-section-head"><h3>Вечірній review</h3><span>5 хв</span></div>
                    <div class="cabinet-review">
                        <p>Що завершено, що перенести, що зависло, що краще делегувати?</p>
                        <a href="/tasks?view=waiting">Відкрити waiting</a>
                        <a href="/tasks?view=today">Відкрити сьогодні</a>
                    </div>
                </section>
            </div>
        </div>`;
}

function renderMyTasksTab() {
    const all = cabinetList('all');
    const segments = [
        ['all', 'Всі мої'],
        ['personal', 'Особисті'],
        ['private', 'Приватні'],
        ['work', 'Робочі'],
        ['waiting', 'Чекаю'],
        ['idea', 'Ідеї']
    ];
    const filtered = all.filter(task => {
        if (myTasksSegment === 'all') return true;
        if (myTasksSegment === 'waiting') return (task.workflowState || task.workflow_state) === 'waiting' || (task.taskKind || task.task_kind) === 'waiting';
        if (myTasksSegment === 'idea') return (task.taskKind || task.task_kind) === 'idea';
        return (task.taskMode || task.task_mode || 'work') === myTasksSegment || (task.visibility === myTasksSegment);
    });
    return `
        <div class="cabinet-shell">
            <div class="cabinet-toolbar">
                <div>
                    <div class="cabinet-kicker">Personal projection</div>
                    <h2>Мої задачі</h2>
                </div>
                <a href="/tasks?view=my" class="cabinet-link-btn">Повний Tasks</a>
            </div>
            ${renderCabinetPulseCluster()}
            <div class="cabinet-segments">
                ${segments.map(([id, label]) => `<button class="${myTasksSegment === id ? 'active' : ''}" onclick="setMyTasksSegment('${id}')">${label}</button>`).join('')}
            </div>
            <div class="cabinet-list">
                ${filtered.length ? filtered.map(task => renderCabinetTaskCard(task)).join('') : '<div class="cabinet-empty">У цьому сегменті поки немає задач.</div>'}
            </div>
        </div>`;
}

function setMyTasksSegment(segment) {
    myTasksSegment = segment;
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

async function handleCabinetTaskActionClick(event) {
    const button = event.currentTarget;
    const action = button?.dataset?.cabinetTaskAction || '';
    const taskId = normalizeCabinetTaskId(button?.dataset?.taskId);
    if (!taskId) {
        if (typeof showNotification === 'function') showNotification('Не вдалося визначити задачу', 'error');
        return;
    }

    if (action === 'open') {
        window.location.href = `/tasks?view=my&open=${encodeURIComponent(taskId)}`;
        return;
    }

    button.disabled = true;
    button.classList.add('is-busy');
    try {
        if (action === 'done') {
            await setCabinetTaskStatus(taskId, 'done');
        } else if (action === 'snooze') {
            await snoozeCabinetTask(taskId, button.dataset.minutes || 60);
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

async function setCabinetTaskStatus(taskId, status) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) throw new Error('Invalid task id');
    let result;
    if (status === 'done') {
        result = await apiPost(`/tasks/${id}/complete`, { sourceSurface: 'profile_my_cabinet' });
    } else if (typeof apiQuickTaskStatus === 'function') {
        result = await apiQuickTaskStatus(id, status);
    } else {
        result = await apiPatch(`/auth/tasks/${id}/quick-status`, { status });
    }
    if (!result?.success) throw new Error(result?.error || 'Task status update failed');
    if (typeof showNotification === 'function') {
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
    if (typeof showNotification === 'function') showNotification(`Задачу відкладено на ${delay} хв`, 'success');
    await refreshMyCabinetTab();
}

async function createCabinetTask(event, mode) {
    event.preventDefault();
    const input = document.getElementById('cabinetTaskTitle');
    const title = String(input?.value || '').trim();
    if (!title) return;
    const kind = document.getElementById('cabinetTaskKind')?.value || 'action';
    const current = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser : {};
    await apiPost('/tasks', {
        title,
        ownerUserId: current.id || current.user_id,
        task_mode: mode === 'private' ? 'private' : 'personal',
        task_kind: kind,
        visibility: mode === 'private' ? 'private' : 'me_only',
        workflow_state: 'inbox',
        schedule: { date: new Date().toISOString().slice(0, 10), slot: 'morning', durationMinutes: 30 },
        effort_minutes: 30,
        source_type: 'profile',
        source_module: 'my_cabinet'
    });
    if (input) input.value = '';
    await refreshMyCabinetTab();
}

// ==========================================
// INVENTORY
// ==========================================
function renderInventory() {
    const items = myInventory || [];

    if (items.length === 0) {
        return `<div style="text-align:center;padding:48px 20px">
            <div style="font-size:48px;margin-bottom:12px">🎒</div>
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
        <h3 style="margin-bottom:12px">🎒 Інвентар (${items.length})</h3>
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
    const data = await apiGet('/gamification/shop');
    shopItems = data || [];
}

function renderShopTab() {
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
function attachProfileListeners() {
    document.querySelectorAll('[data-cabinet-task-action]').forEach(button => {
        if (button.dataset.cabinetActionBound === 'true') return;
        button.dataset.cabinetActionBound = 'true';
        button.addEventListener('click', handleCabinetTaskActionClick);
    });

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
    seasonalQuests = await apiGet('/gamification/seasons');
    // Also check progress
    await apiPost('/gamification/seasons/check');
    seasonalQuests = await apiGet('/gamification/seasons');
}

function renderSeasonTab() {
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
    const [teams, challenges] = await Promise.all([
        apiGet('/gamification/teams'),
        apiGet('/gamification/challenges')
    ]);
    teamsData = teams;
    challengesData = Array.isArray(challenges) ? challenges : [];
}

function renderTeamsTab() {
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
    referralData = await apiGet('/gamification/referral');
}

function renderReferralTab() {
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
document.addEventListener('DOMContentLoaded', initProfilePage);
