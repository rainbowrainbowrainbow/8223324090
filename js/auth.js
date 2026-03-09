/**
 * auth.js - Авторизація та управління сесією
 * v5.0: Server-side JWT authentication
 */

// ==========================================
// АВТОРИЗАЦІЯ
// ==========================================

async function checkSession() {
    const token = localStorage.getItem('pzp_token');
    const savedUser = localStorage.getItem(CONFIG.STORAGE.CURRENT_USER);

    if (token && savedUser) {
        // Verify token with server
        const user = await apiVerifyToken();
        if (user) {
            AppState.currentUser = user;
            showMainApp();
            return;
        }
        // Token expired or invalid
        localStorage.removeItem('pzp_token');
        localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
    }
    showLoginScreen();
}

async function login(username, password) {
    try {
        const data = await apiLogin(username, password);
        AppState.currentUser = data.user;
        localStorage.setItem('pzp_token', data.token);
        localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(data.user));
        showMainApp();
        // v22.5: Check daily login reward
        checkDailyLogin();
        return { success: true };
    } catch (err) {
        console.error('Login error:', err);
        return { success: false, error: err.message || 'Невірний логін або пароль' };
    }
}

function logout() {
    // v9.1: Disconnect WebSocket on logout
    if (typeof ParkWS !== 'undefined') ParkWS.disconnect();

    AppState.currentUser = null;
    localStorage.removeItem('pzp_token');
    localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
    localStorage.removeItem(CONFIG.STORAGE.SESSION);
    showLoginScreen();
}

function showLoginScreen() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    // Hide floating buttons that are outside mainApp
    const sidebarToggle = document.getElementById('sidebarToggle');
    const improvementFab = document.getElementById('improvementFab');
    if (sidebarToggle) sidebarToggle.classList.add('hidden');
    if (improvementFab) improvementFab.classList.add('hidden');
}

// v22.0.0: Role hierarchy — 25 roles (higher index = more permissions)
const ROLE_HIERARCHY = [
    'waiter', 'dishwasher', 'maintenance', 'cleaning', 'wardrobe', 'barista',
    'reception', 'animator', 'pastry_chef', 'head_pastry', 'cook', 'head_chef',
    'instructor', 'senior_instructor', 'admin', 'hr', 'it_specialist',
    'marketer', 'art_director', 'accountant', 'manager', 'senior_manager',
    'vice_director', 'director', 'creator'
];
const ROLE_LEVEL = {};
ROLE_HIERARCHY.forEach((r, i) => ROLE_LEVEL[r] = i);

const ROLE_NAMES = {
    creator: 'Творець', director: 'Директор', vice_director: 'Заст. директора',
    senior_manager: 'Старший менеджер', manager: 'Менеджер',
    accountant: 'Бухгалтер', art_director: 'Арт-директор', marketer: 'Маркетолог',
    it_specialist: 'IT-спеціаліст', hr: 'HR-менеджер',
    admin: 'Адміністратор',
    senior_instructor: 'Старший інструктор', instructor: 'Інструктор',
    head_chef: 'Шеф-кухар', cook: 'Кухар', head_pastry: 'Шеф-кондитер', pastry_chef: 'Кондитер',
    animator: 'Аніматор', reception: 'Рецепція', barista: 'Бариста',
    wardrobe: 'Гардеробник', cleaning: 'Клінінг', maintenance: 'Технік',
    dishwasher: 'Посудомийник', waiter: 'Офіціант'
};

// v22.0.0: Role groups for cleaner access control
const _MANAGEMENT_UP = ['creator', 'director', 'vice_director', 'senior_manager'];
const _MANAGER_UP = [..._MANAGEMENT_UP, 'manager'];
const _ADMIN_UP = [..._MANAGER_UP, 'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin'];
const _ALL_STAFF = ROLE_HIERARCHY.filter(r => r !== 'waiter');

const PAGE_ACCESS = {
    '/dashboard': ROLE_HIERARCHY.slice(),
    '/':          _ALL_STAFF,
    '/tasks':     _ALL_STAFF,
    '/chat':      _ALL_STAFF,
    '/center':    _MANAGEMENT_UP,
    '/art':       [..._MANAGEMENT_UP, 'art_director'],
    '/customers': [..._ADMIN_UP, 'reception'],
    '/staff':     [..._MANAGEMENT_UP, 'hr'],
    '/warehouse': [..._MANAGEMENT_UP, 'admin'],
    '/training':  [..._MANAGER_UP, 'senior_instructor', 'instructor'],
    '/settings':  ['creator', 'director'],
    '/demo':      _MANAGER_UP,
    '/programs':  [..._ADMIN_UP, 'senior_instructor'],
    '/hr':        [..._MANAGEMENT_UP, 'hr'],
    '/finance':   ['creator', 'director', 'accountant'],
    '/analytics': _MANAGEMENT_UP,
    '/status':    _MANAGEMENT_UP,
};

const ACTION_PERMISSIONS = {
    create_booking:  [..._ADMIN_UP, 'reception'],
    edit_booking:    [..._ADMIN_UP, 'reception'],
    cancel_booking:  _MANAGER_UP,
    delete_booking:  ['creator', 'director'],
    manage_users:    ['creator', 'director'],
    view_revenue:    [..._MANAGEMENT_UP, 'accountant'],
    manage_settings: ['creator', 'director'],
    export_data:     _MANAGEMENT_UP,
};

function getUserRole() {
    // v22.0.0: Test panel support — creator can simulate other roles
    const testRole = localStorage.getItem('pzp_test_role');
    if (testRole && AppState.currentUser && AppState.currentUser.role === 'creator') {
        return testRole;
    }
    return AppState.currentUser ? AppState.currentUser.role : null;
}

function hasMinRole(minRole) {
    const role = getUserRole();
    return role && (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[minRole] || 99);
}

function canAccess(action) {
    const role = getUserRole();
    const allowed = ACTION_PERMISSIONS[action];
    return role && allowed && allowed.includes(role);
}

function canAccessPage(page) {
    const role = getUserRole();
    const allowed = PAGE_ACCESS[page];
    if (!allowed) return true; // unknown page = allow
    return role && allowed.includes(role);
}

function isViewer() {
    const role = getUserRole();
    const viewerRoles = ['waiter', 'dishwasher', 'maintenance', 'cleaning', 'wardrobe', 'barista', 'reception', 'animator', 'pastry_chef', 'cook', 'instructor'];
    return viewerRoles.includes(role);
}

function canManageProducts() {
    return hasMinRole('manager');
}

function isAdmin() {
    return hasMinRole('admin');
}

function isManagement() {
    return hasMinRole('senior_manager');
}

function showMainApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('currentUser').textContent = AppState.currentUser.name;
    // Show floating buttons hidden during logout
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) sidebarToggle.classList.remove('hidden');

    // v8.6: Close all panels/modals on page load to prevent stale empty views
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    ['certificatesPanel', 'bookingPanel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    document.body.classList.remove('panel-open');
    const backdrop = document.getElementById('panelBackdrop');
    if (backdrop) backdrop.classList.add('hidden');

    // Settings (gear) — тільки для creator/director
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.classList.toggle('hidden', !canAccess('manage_settings'));
    }

    // Certificates — доступно всім ролям
    const certificatesBtn = document.getElementById('certificatesBtn');
    if (certificatesBtn) {
        certificatesBtn.classList.remove('hidden');
    }

    // Дашборд (icon) — не для Animator
    const dashboardBtn = document.getElementById('dashboardBtn');
    if (dashboardBtn) {
        dashboardBtn.classList.toggle('hidden', isViewer());
    }

    // Показати кнопку "Розважальні програми"
    const programsTabBtn = document.getElementById('programsTabBtn');
    if (programsTabBtn) {
        programsTabBtn.classList.remove('hidden');
    }

    // v20.1.0: Sidebar role-based visibility via page access matrix
    const role = getUserRole();
    document.querySelectorAll('[data-page-access]').forEach(el => {
        const page = el.dataset.pageAccess;
        el.classList.toggle('hidden', !canAccessPage(page));
    });
    // Legacy classes for backward compat
    document.querySelectorAll('.sidebar-admin-only').forEach(el => {
        el.classList.toggle('hidden', !canAccess('manage_settings'));
    });
    document.querySelectorAll('.sidebar-no-viewer').forEach(el => {
        el.classList.toggle('hidden', isViewer());
    });
    // Sidebar certificates — visible to all
    const sidebarCerts = document.getElementById('sidebarCertificatesBtn');
    if (sidebarCerts) sidebarCerts.classList.remove('hidden');

    // v20.1.0: Hide booking creation buttons for roles that can't create
    if (!canAccess('create_booking')) {
        const addLineBtn = document.getElementById('addLineBtn');
        if (addLineBtn) addLineBtn.style.display = 'none';
        const exportBtn = document.getElementById('exportTimelineBtn');
        if (exportBtn) exportBtn.style.display = 'none';
    }

    // Dark mode toggle
    const darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle) darkToggle.checked = AppState.darkMode;
    const darkIcon = document.getElementById('darkModeIcon');
    if (darkIcon) darkIcon.textContent = AppState.darkMode ? '☀️' : '🌙';

    // Compact mode toggle
    const compactToggle = document.getElementById('compactModeToggle');
    if (compactToggle) compactToggle.checked = AppState.compactMode;

    // Zoom buttons
    updateZoomButtons();

    // Undo button
    updateUndoButton();

    // Status filter restore
    if (AppState.statusFilter && AppState.statusFilter !== 'all') {
        document.querySelectorAll('.status-filter-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.filter === AppState.statusFilter);
        });
    }

    initializeTimeline();
    renderProgramIcons();
    setupSwipe();

    // v9.1: Connect WebSocket for live-sync
    if (typeof ParkWS !== 'undefined') ParkWS.connect();

    // v8.0: Show improvement suggestion FAB
    if (typeof showImprovementFab === 'function') showImprovementFab();

    // v20.2.0: Initialize floating command panel
    if (typeof CommandPanel !== 'undefined') CommandPanel.init();

    // Idle hint bubbles near cmd-fab
    if (typeof IdleHints !== 'undefined') IdleHints.init();

    // v10.3: Personal cabinet — click on username
    const userNameEl = document.getElementById('currentUser');
    if (userNameEl) {
        userNameEl.addEventListener('click', openProfileModal);
        userNameEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfileModal(); }
        });
    }
}

// v10.6: Personal cabinet — full rebuild with tabs, achievements, shift, inbox, progress ring
const PROFILE_ACTION_NAMES = {
    create: 'Створення', edit: 'Редагування', delete: 'Видалення', confirm: 'Підтвердження',
    cancel: 'Скасування', afisha_create: 'Афіша +', afisha_edit: 'Афіша ред.',
    afisha_delete: 'Афіша —', tasks_generated: 'Задачі згенер.', recurring_create: 'Recurring',
    afisha_move: 'Переміщення', duplicate: 'Дублювання', certificate_create: 'Сертифікат +',
    certificate_used: 'Сертифікат використ.', certificate_revoked: 'Сертифікат скасов.'
};

// Cached achievement definitions
let _achievementDefs = null;

function profileFormatTime(dateStr) {
    return new Date(dateStr).toLocaleString('uk-UA', {
        timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
}

function profileActivityDetail(a) {
    try {
        const d = typeof a.data === 'string' ? JSON.parse(a.data) : a.data;
        return d.label || d.title || d.program || d.bookingId || '';
    } catch { return ''; }
}

function profileRenderActivityItems(items) {
    if (!items || items.length === 0) return '<div class="profile-empty">Немає активності</div>';
    return items.map(a => {
        const actionLabel = PROFILE_ACTION_NAMES[a.action] || a.action;
        const time = profileFormatTime(a.created_at);
        const detail = profileActivityDetail(a);
        return `<div class="profile-activity-item"><span class="profile-activity-action">${actionLabel}</span><span class="profile-activity-detail">${detail}</span><span class="profile-activity-time">${time}</span></div>`;
    }).join('');
}

function _profileDelta(d) {
    if (!d || d.thisWeek === d.lastWeek) return '';
    const diff = d.thisWeek - d.lastWeek;
    const cls = diff > 0 ? 'positive' : 'negative';
    return `<span class="prof-delta ${cls}">${diff > 0 ? '+' : ''}${diff}</span>`;
}

function _profileProgressRing(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const circumference = 2 * Math.PI * 36;
    const offset = circumference - (pct / 100) * circumference;
    return `<div class="prof-ring-wrap">
        <svg class="prof-ring" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="36" fill="none" stroke="var(--gray-100)" stroke-width="6"/>
            <circle cx="40" cy="40" r="36" fill="none" stroke="var(--primary)" stroke-width="6"
                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                stroke-linecap="round" transform="rotate(-90 40 40)"/>
        </svg>
        <div class="prof-ring-text"><span class="prof-ring-pct">${pct}%</span></div>
    </div>`;
}

async function openProfileModal() {
    const modal = document.getElementById('profileModal');
    const content = document.getElementById('profileContent');
    if (!modal || !content) return;

    modal.classList.remove('hidden');
    content.innerHTML = '<div class="profile-loading">Завантаження...</div>';

    // Log opening
    if (typeof apiLogAction === 'function') apiLogAction('open_profile', 'cabinet');

    // Load data and achievement definitions in parallel
    const [data, achDefs] = await Promise.all([
        apiGetProfile(),
        _achievementDefs ? Promise.resolve(_achievementDefs) : apiGetAchievements()
    ]);
    if (achDefs) _achievementDefs = achDefs;

    if (!data) {
        content.innerHTML = '<div class="profile-error">Не вдалося завантажити дані</div>';
        return;
    }

    // Store data globally for tab re-renders
    window._profileData = data;

    const roleName = ROLE_NAMES[data.user.role] || data.user.role;
    const tgStatus = data.user.telegramConnected;
    const rank = data.leaderboard.rank ? `#${data.leaderboard.rank}` : '—';

    // Build the shell: header + tabs + tab content
    content.innerHTML = `
        <div class="profile-header">
            <div class="profile-avatar">${data.user.name.charAt(0).toUpperCase()}</div>
            <div class="profile-info">
                <div class="profile-name">${data.user.name}</div>
                <div class="profile-role">${roleName}</div>
                <div class="profile-tg-badge ${tgStatus ? 'connected' : ''}">${tgStatus ? 'TG' : 'TG —'}</div>
            </div>
            <div class="profile-header-stats">
                <div class="prof-mini-stat"><span class="prof-mini-val">${data.points.permanentTotal}</span><span class="prof-mini-lbl">балів</span></div>
                <div class="prof-mini-stat"><span class="prof-mini-val">${rank}</span><span class="prof-mini-lbl">ранг</span></div>
                <div class="prof-mini-stat"><span class="prof-mini-val">${data.streak.current || 0}</span><span class="prof-mini-lbl">стрік</span></div>
            </div>
        </div>

        <div class="prof-tabs" role="tablist">
            <button class="prof-tab active" data-tab="today" role="tab">Сьогодні</button>
            <button class="prof-tab" data-tab="game" role="tab">Гра</button>
            <button class="prof-tab" data-tab="tasks" role="tab">Задачі</button>
            <button class="prof-tab" data-tab="stats" role="tab">Стати</button>
            <button class="prof-tab" data-tab="settings" role="tab">Налашт.</button>
        </div>

        <div class="prof-tab-content" id="profTabContent"></div>
    `;

    // Tab switching
    content.querySelectorAll('.prof-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            content.querySelectorAll('.prof-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _profileRenderTab(btn.dataset.tab, data, achDefs);
            if (typeof apiLogAction === 'function') apiLogAction('profile_tab', btn.dataset.tab);
        });
    });

    // Render "Today" tab by default
    _profileRenderTab('today', data, achDefs);
    window._profileActivityOffset = data.recentActivity.length;
}

function _profileRenderTab(tabName, data, achDefs) {
    const container = document.getElementById('profTabContent');
    if (!container) return;

    switch (tabName) {
        case 'today': container.innerHTML = _profileTabToday(data); break;
        case 'game': _profileTabGame(container, data); break;
        case 'tasks': container.innerHTML = _profileTabTasks(data); break;
        case 'stats': container.innerHTML = _profileTabStats(data, achDefs); break;
        case 'settings': container.innerHTML = _profileTabSettings(data); break;
    }
}

// ==========================================
// TAB: СЬОГОДНІ
// ==========================================
function _profileTabToday(data) {
    const dp = data.dayProgress;
    const totalDayTasks = dp.tasksDoneToday + dp.tasksRemaining;

    // Shift block
    let shiftHTML = '';
    if (data.todayShift) {
        const s = data.todayShift;
        const statusMap = { working: 'На зміні', dayoff: 'Вихідний', vacation: 'Відпустка', sick: 'Лікарняний' };
        const statusCls = s.status === 'working' ? 'active' : 'off';
        shiftHTML = `<div class="prof-shift ${statusCls}">
            <div class="prof-shift-status">${statusMap[s.status] || s.status}</div>
            ${s.start ? `<div class="prof-shift-time">${s.start} — ${s.end}</div>` : ''}
            ${s.note ? `<div class="prof-shift-note">${s.note}</div>` : ''}
        </div>`;
    }

    // Day progress ring
    const progressHTML = `<div class="prof-day-progress">
        ${_profileProgressRing(dp.tasksDoneToday, totalDayTasks)}
        <div class="prof-day-nums">
            <div class="prof-day-num-row"><span class="prof-day-done">${dp.tasksDoneToday}</span> виконано</div>
            <div class="prof-day-num-row"><span class="prof-day-rem">${dp.tasksRemaining}</span> залишилось</div>
            <div class="prof-day-num-row">${dp.bookingsToday} бронювань</div>
        </div>
    </div>`;

    // Inbox: overdue + upcoming as actionable items
    let inboxHTML = '';
    const inboxItems = [];
    if (data.tasks.overdueList && data.tasks.overdueList.length > 0) {
        data.tasks.overdueList.forEach(t => {
            const ago = Math.round((new Date() - new Date(t.deadline)) / 3600000);
            inboxItems.push(`<div class="prof-inbox-item danger" data-task-id="${t.id}">
                <span class="prof-inbox-icon">!</span>
                <div class="prof-inbox-body">
                    <div class="prof-inbox-title">${t.title}</div>
                    <div class="prof-inbox-meta">Прострочено ${ago} год</div>
                </div>
                <div class="prof-inbox-actions">
                    <button class="prof-inbox-btn done" onclick="profileQuickStatus(${t.id},'done')" title="Готово">&#10003;</button>
                    <button class="prof-inbox-btn progress" onclick="profileQuickStatus(${t.id},'in_progress')" title="В роботу">&#9654;</button>
                </div>
            </div>`);
        });
    }
    if (data.tasks.upcoming && data.tasks.upcoming.length > 0) {
        data.tasks.upcoming.forEach(t => {
            const dl = new Date(t.deadline);
            const mins = Math.round((dl - new Date()) / 60000);
            const timeStr = mins < 60 ? `${mins} хв` : `${Math.round(mins / 60)} год`;
            inboxItems.push(`<div class="prof-inbox-item warning" data-task-id="${t.id}">
                <span class="prof-inbox-icon">&#9202;</span>
                <div class="prof-inbox-body">
                    <div class="prof-inbox-title">${t.title}</div>
                    <div class="prof-inbox-meta">Дедлайн через ${timeStr}</div>
                </div>
                <div class="prof-inbox-actions">
                    <button class="prof-inbox-btn done" onclick="profileQuickStatus(${t.id},'done')" title="Готово">&#10003;</button>
                    <button class="prof-inbox-btn progress" onclick="profileQuickStatus(${t.id},'in_progress')" title="В роботу">&#9654;</button>
                </div>
            </div>`);
        });
    }

    if (inboxItems.length > 0) {
        inboxHTML = `<div class="prof-section">
            <h4>Потребують уваги <span class="prof-badge-count">${inboxItems.length}</span></h4>
            <div class="prof-inbox">${inboxItems.join('')}</div>
        </div>`;
    } else {
        inboxHTML = `<div class="prof-section"><div class="prof-all-clear">Все під контролем!</div></div>`;
    }

    // Admin: team overview
    let teamHTML = '';
    if (data.team && data.team.length > 0) {
        const teamItems = data.team.map(m => {
            const hasOverdue = m.overdueTasks > 0;
            return `<div class="prof-team-member ${hasOverdue ? 'has-overdue' : ''}">
                <div class="prof-team-avatar">${m.name.charAt(0)}</div>
                <div class="prof-team-info">
                    <div class="prof-team-name">${m.name}</div>
                    <div class="prof-team-tasks">${m.openTasks} задач${hasOverdue ? ` / <span class="danger">${m.overdueTasks} протерм.</span>` : ''}</div>
                </div>
            </div>`;
        }).join('');
        teamHTML = `<div class="prof-section">
            <h4>Команда</h4>
            <div class="prof-team-grid">${teamItems}</div>
        </div>`;
    }

    return `${shiftHTML}${progressHTML}${inboxHTML}${teamHTML}`;
}

// ==========================================
// TAB: ЗАДАЧІ (with inline actions)
// ==========================================
function _profileTabTasks(data) {
    if (!data.myTasks || data.myTasks.length === 0) {
        return '<div class="prof-section"><div class="prof-all-clear">Немає активних задач</div></div>';
    }

    const taskItems = data.myTasks.map(t => {
        const icon = t.isBlocked ? '&#128274;' : (t.status === 'in_progress' ? '&#9673;' : (t.isOverdue ? '&#9888;' : '&#9675;'));
        const cls = t.isOverdue ? 'overdue' : (t.isBlocked ? 'blocked' : t.status);
        const deadlineStr = t.deadline ? profileFormatTime(t.deadline) : '';
        const priorityCls = t.priority === 'critical' || t.priority === 'high' ? 'high-priority' : '';
        const blockedLabel = t.isBlocked ? '<span class="prof-blocked-lbl">Заблоковано</span>' : '';

        // Action buttons based on current status
        let actionsHTML = '';
        if (!t.isBlocked) {
            if (t.status === 'todo') {
                actionsHTML = `<button class="prof-task-btn start" onclick="profileQuickStatus(${t.id},'in_progress')" title="Почати">&#9654;</button>
                    <button class="prof-task-btn done" onclick="profileQuickStatus(${t.id},'done')" title="Готово">&#10003;</button>`;
            } else if (t.status === 'in_progress') {
                actionsHTML = `<button class="prof-task-btn done" onclick="profileQuickStatus(${t.id},'done')" title="Готово">&#10003;</button>`;
            }
        }

        return `<div class="prof-task-row ${cls} ${priorityCls}" data-task-id="${t.id}">
            <span class="prof-task-icon">${icon}</span>
            <div class="prof-task-body">
                <div class="prof-task-title">${t.title}</div>
                <div class="prof-task-meta">${deadlineStr}${blockedLabel}<span class="prof-task-cat">${t.category || ''}</span></div>
            </div>
            <div class="prof-task-actions">${actionsHTML}</div>
        </div>`;
    }).join('');

    // Task summary chips
    const summaryHTML = `<div class="prof-task-summary">
        <span class="prof-chip todo">${data.tasks.assigned || 0} очікує</span>
        <span class="prof-chip progress">${data.tasks.in_progress || 0} в роботі</span>
        <span class="prof-chip done">${data.tasks.done || 0} готово</span>
        ${data.tasks.overdue > 0 ? `<span class="prof-chip overdue">${data.tasks.overdue} протерм.</span>` : ''}
    </div>`;

    return `<div class="prof-section">${summaryHTML}<div class="prof-tasks-list">${taskItems}</div></div>`;
}

// ==========================================
// TAB: СТАТИСТИКА (points, bookings, certs, achievements)
// ==========================================
function _profileTabStats(data, achDefs) {
    const bk = data.bookings;
    const monthName = new Date(data.points.month + '-01').toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });

    // Stats summary with deltas
    const statsHTML = `<div class="prof-stats-grid">
        <div class="prof-stat-card">
            <div class="prof-stat-num">${bk ? bk.total : 0}${_profileDelta(data.deltas.bookings)}</div>
            <div class="prof-stat-lbl">Бронювань</div>
        </div>
        <div class="prof-stat-card">
            <div class="prof-stat-num">${data.tasks.done || 0}${_profileDelta(data.deltas.tasksDone)}</div>
            <div class="prof-stat-lbl">Виконано</div>
        </div>
        <div class="prof-stat-card">
            <div class="prof-stat-num">${data.tasks.total || 0}</div>
            <div class="prof-stat-lbl">Всього задач</div>
        </div>
        <div class="prof-stat-card">
            <div class="prof-stat-num">${data.certificates.total || 0}</div>
            <div class="prof-stat-lbl">Сертифікатів</div>
        </div>
    </div>`;

    // Points
    let txHTML = '';
    if (data.pointTransactions && data.pointTransactions.length > 0) {
        const reasonMap = { ON_TIME: 'Вчасно', EARLY: 'Раніше строку', HIGH_PRIORITY: 'Пріоритетна', LATE_MINOR: 'Невелике запізн.', LATE_MAJOR: 'Значне запізн.', NO_STATUS_UPDATE: 'Без оновлення', manual: 'Ручне' };
        txHTML = data.pointTransactions.map(tx => {
            const sign = tx.points > 0 ? '+' : '';
            const cls = tx.points >= 0 ? 'positive' : 'negative';
            const reasonLabel = reasonMap[tx.reason] || tx.reason || '';
            const taskLink = tx.taskTitle ? ` (${tx.taskTitle})` : '';
            return `<div class="profile-points-row"><span>${reasonLabel}${taskLink}</span><span class="profile-points-val ${cls}">${sign}${tx.points}</span></div>`;
        }).join('');
    }
    const pointsHTML = `<div class="prof-section">
        <h4>Бали за ${monthName}</h4>
        <div class="profile-points-row"><span>Місячні</span><span class="profile-points-val ${data.points.monthly >= 0 ? 'positive' : 'negative'}">${data.points.monthly > 0 ? '+' : ''}${data.points.monthly}</span></div>
        <div class="profile-points-row"><span>Постійні (всього)</span><span class="profile-points-val positive">+${data.points.permanentTotal}</span></div>
        ${txHTML ? '<div class="profile-tx-divider">Останні нарахування</div>' + txHTML : ''}
    </div>`;

    // Task stats
    let taskStatsHTML = '';
    if (data.tasks.avgCompletionHours !== null || data.tasks.escalations > 0 || (data.tasks.byCategory && data.tasks.byCategory.length > 0)) {
        taskStatsHTML = `<div class="prof-section"><h4>Деталі задач</h4>
            ${data.tasks.avgCompletionHours !== null ? `<div class="profile-stat-row">Серед. час виконання: <strong>${data.tasks.avgCompletionHours} год</strong></div>` : ''}
            ${data.tasks.escalations > 0 ? `<div class="profile-stat-row">Ескалацій: <strong>${data.tasks.escalations}</strong></div>` : ''}
            ${data.tasks.escalationHistory && data.tasks.escalationHistory.length > 0 ?
                data.tasks.escalationHistory.map(e => `<div class="prof-escalation-item">${e.title} — рівень ${e.from} &#8594; ${e.to} (${profileFormatTime(e.at)})</div>`).join('') : ''}
            ${data.tasks.byCategory && data.tasks.byCategory.length > 0 ? `<div class="profile-stat-row">По категоріях: ${data.tasks.byCategory.map(c => `<span class="profile-cat-chip">${c.category} (${c.count})</span>`).join(' ')}</div>` : ''}
        </div>`;
    }

    // Bookings detail
    let bookingsHTML = '';
    if (bk && bk.total > 0) {
        const confirmed = bk.byStatus.confirmed || 0;
        const preliminary = bk.byStatus.preliminary || 0;
        const cancelled = bk.byStatus.cancelled || 0;
        bookingsHTML = `<div class="prof-section"><h4>Бронювання</h4>
            <div class="profile-points-row"><span>Підтверджених</span><span class="profile-points-val positive">${confirmed}</span></div>
            <div class="profile-points-row"><span>Попередніх</span><span class="profile-points-val">${preliminary}</span></div>
            ${cancelled > 0 ? `<div class="profile-points-row"><span>Скасованих</span><span class="profile-points-val negative">${cancelled}</span></div>` : ''}
            ${data.showRevenue ? `<div class="profile-points-row"><span>Виручка</span><span class="profile-points-val positive">${bk.revenue.toLocaleString('uk-UA')} &#8372;</span></div>` : ''}
            ${bk.topPrograms && bk.topPrograms.length > 0 ? `<div class="profile-stat-row">Топ: ${bk.topPrograms.map(p => `${p.program_name} (${p.count})`).join(', ')}</div>` : ''}
        </div>`;
    }

    // Certificates detail
    let certsHTML = '';
    if (data.certificates && data.certificates.total > 0) {
        const cert = data.certificates;
        const recentHTML = cert.recentList && cert.recentList.length > 0 ?
            cert.recentList.slice(0, 5).map(c => {
                const stCls = c.status === 'active' ? 'positive' : (c.status === 'used' ? '' : 'negative');
                const stLabel = c.status === 'active' ? 'Активний' : (c.status === 'used' ? 'Використаний' : c.status);
                return `<div class="profile-points-row"><span>${c.code} — ${c.name}</span><span class="profile-points-val ${stCls}">${stLabel}</span></div>`;
            }).join('') : '';
        certsHTML = `<div class="prof-section"><h4>Сертифікати видані (${cert.total})</h4>
            ${cert.byStatus.active ? `<div class="profile-points-row"><span>Активних</span><span class="profile-points-val positive">${cert.byStatus.active}</span></div>` : ''}
            ${cert.byStatus.used ? `<div class="profile-points-row"><span>Використаних</span><span class="profile-points-val">${cert.byStatus.used}</span></div>` : ''}
            ${recentHTML ? '<div class="profile-tx-divider">Останні</div>' + recentHTML : ''}
        </div>`;
    }

    // Achievements
    let achievementsHTML = '';
    if (achDefs) {
        const unlockedKeys = new Set((data.achievements || []).map(a => a.key));
        const allKeys = Object.keys(achDefs);
        const achItems = allKeys.map(key => {
            const def = achDefs[key];
            const unlocked = unlockedKeys.has(key);
            return `<div class="prof-achievement ${unlocked ? 'unlocked' : 'locked'}">
                <span class="prof-ach-icon">${def.icon || '?'}</span>
                <div class="prof-ach-info">
                    <div class="prof-ach-title">${def.title}</div>
                    <div class="prof-ach-desc">${def.desc}</div>
                </div>
            </div>`;
        }).join('');
        achievementsHTML = `<div class="prof-section"><h4>Досягнення <span class="prof-badge-count">${unlockedKeys.size}/${allKeys.length}</span></h4>
            <div class="prof-achievements">${achItems}</div>
        </div>`;
    }

    // Activity
    const activityItemsHTML = profileRenderActivityItems(data.recentActivity);
    const activityHTML = `<div class="prof-section">
        <h4>Остання активність</h4>
        <div id="profileActivityList" class="profile-activity">${activityItemsHTML}</div>
        ${data.recentActivity.length >= 20 ? '<button class="btn-profile-load-more" onclick="profileLoadMoreActivity()">Показати ще</button>' : ''}
    </div>`;

    return `${statsHTML}${pointsHTML}${taskStatsHTML}${bookingsHTML}${certsHTML}${achievementsHTML}${activityHTML}`;
}

// ==========================================
// TAB: НАЛАШТУВАННЯ
// ==========================================
function _profileTabSettings(data) {
    const tgStatus = data.user.telegramConnected;
    const createdAt = new Date(data.user.createdAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });

    return `
        <div class="prof-section">
            <div class="prof-user-details">
                <div class="profile-points-row"><span>Користувач</span><span class="profile-points-val">${data.user.username}</span></div>
                <div class="profile-points-row"><span>Зареєстрований</span><span class="profile-points-val">${createdAt}</span></div>
                <div class="profile-points-row"><span>Telegram</span><span class="profile-points-val ${tgStatus ? 'positive' : ''}">${tgStatus ? 'Підключено' : 'Не підключено'}</span></div>
            </div>
        </div>
        <div class="prof-section">
            <h4>Змінити пароль</h4>
            <div id="profilePasswordForm" class="profile-password-form" style="display:block;background:transparent;border:none;padding:0;">
                <input type="password" id="profileCurrentPwd" placeholder="Поточний пароль" autocomplete="current-password">
                <input type="password" id="profileNewPwd" placeholder="Новий пароль (мін. 6 символів)" autocomplete="new-password">
                <div class="profile-pwd-actions">
                    <button class="btn-profile-save" onclick="profileChangePassword()">Зберегти</button>
                </div>
                <div id="profilePwdError" class="profile-pwd-error hidden"></div>
                <div id="profilePwdSuccess" class="profile-pwd-success hidden"></div>
            </div>
        </div>
        <div class="prof-section">
            <button class="btn-profile-action prof-logout-btn" onclick="logout()">Вийти з акаунту</button>
        </div>`;
}

// ==========================================
// TAB: ГРА (Gamification — achievements, shop, inventory, leaderboard)
// ==========================================
let _gameTabData = null;
let _gameSubTab = 'achievements';

async function _profileTabGame(container, data) {
    container.innerHTML = '<div class="profile-loading">Завантаження...</div>';

    const username = data.user.username;
    const [profile, achievements, shop, leaderboard] = await Promise.all([
        apiGamificationProfile(username),
        apiGamificationAchievements(),
        apiGamificationShop(),
        apiGamificationLeaderboard('xp')
    ]);

    _gameTabData = { profile, achievements, shop, leaderboard, username };

    if (!profile) {
        container.innerHTML = '<div class="prof-section"><div class="profile-empty">Гейміфікація недоступна</div></div>';
        return;
    }

    _gameSubTab = 'achievements';
    _renderGameTab(container);
}

function _renderGameTab(container) {
    const { profile, achievements, shop, leaderboard } = _gameTabData;
    const p = profile; // API returns flat object with profile, currency, level, etc.
    const profileData = p.profile || {};
    const level = p.level || { level: 1, title: 'Новачок', xp: 0, xpForNext: 100 };
    const coins = p.currency ? p.currency.coins : 0;
    const xp = profileData.xp || 0;

    // XP progress
    const xpForCurrent = level.xpForCurrent || 0;
    const xpForNext = level.xpForNext || 100;
    const xpProgress = xpForNext > xpForCurrent ? Math.min(100, Math.round((xp - xpForCurrent) / (xpForNext - xpForCurrent) * 100)) : 100;

    const headerHTML = `
        <div class="game-profile-header">
            <div class="game-level-badge">Lv.${level.level}</div>
            <div class="game-profile-info">
                <div class="game-title">${level.title || 'Новачок'}</div>
                <div class="game-xp-bar">
                    <div class="game-xp-fill" style="width:${xpProgress}%"></div>
                </div>
                <div class="game-xp-text">${xp} / ${xpForNext} XP</div>
            </div>
            <div class="game-coins">${coins} <span class="game-coin-icon">&#x1FA99;</span></div>
        </div>
    `;

    // Sub-tabs
    const subTabs = [
        { key: 'achievements', label: 'Досягнення' },
        { key: 'inventory', label: 'Інвентар' },
        { key: 'shop', label: 'Магазин' },
        { key: 'leaderboard', label: 'Лідери' }
    ];
    const subTabsHTML = `<div class="game-sub-tabs">${subTabs.map(t =>
        `<button class="game-sub-tab ${_gameSubTab === t.key ? 'active' : ''}" onclick="_switchGameSubTab('${t.key}')">${t.label}</button>`
    ).join('')}</div>`;

    let contentHTML = '';
    switch (_gameSubTab) {
        case 'achievements': contentHTML = _renderGameAchievements(achievements, profile); break;
        case 'inventory': contentHTML = _renderGameInventory(); break;
        case 'shop': contentHTML = _renderGameShop(shop, coins); break;
        case 'leaderboard': contentHTML = _renderGameLeaderboard(leaderboard); break;
    }

    container.innerHTML = headerHTML + subTabsHTML + `<div class="game-content">${contentHTML}</div>`;
}

function _switchGameSubTab(tab) {
    _gameSubTab = tab;
    const container = document.getElementById('profTabContent');
    if (container && _gameTabData) _renderGameTab(container);
}

function _renderGameAchievements(achievements, profile) {
    if (!achievements || !Array.isArray(achievements) || achievements.length === 0) {
        return '<div class="profile-empty">Немає досягнень</div>';
    }
    const items = achievements;
    if (items.length === 0) return '<div class="profile-empty">Немає досягнень</div>';

    const unlocked = items.filter(a => a.unlocked).length;
    const rarityColors = { common: '#9CA3AF', uncommon: '#34D399', rare: '#60A5FA', epic: '#A78BFA', legendary: '#FBBF24' };

    const html = items.map(a => {
        const cls = a.unlocked ? 'unlocked' : 'locked';
        const rarityColor = rarityColors[a.rarity] || '#9CA3AF';
        const rewardText = a.reward_type === 'coins' ? `${a.reward_value} монет` :
                          a.reward_type === 'xp' ? `${a.reward_value} XP` : (a.reward_value || '');
        return `<div class="game-ach-card ${cls}">
            <div class="game-ach-icon">${a.icon || '?'}</div>
            <div class="game-ach-body">
                <div class="game-ach-name">${a.name || a.key}</div>
                <div class="game-ach-desc">${a.description || ''}</div>
                ${rewardText ? `<div class="game-ach-reward">${rewardText}</div>` : ''}
            </div>
            <div class="game-ach-rarity" style="color:${rarityColor}">${a.rarity || ''}</div>
        </div>`;
    }).join('');

    return `<div class="game-ach-header">${unlocked}/${items.length} відкрито</div>${html}`;
}

function _renderGameInventory() {
    const profile = _gameTabData.profile || {};
    const inventory = profile.inventory || [];
    const equipped = profile.equipped || [];

    if (inventory.length === 0) {
        return '<div class="profile-empty">Інвентар порожній. Придбайте предмети в магазині!</div>';
    }

    const equippedIds = new Set(equipped.map(e => e.item_id));

    const html = inventory.map(item => {
        const isEquipped = equippedIds.has(item.id || item.item_id);
        return `<div class="game-inv-item ${isEquipped ? 'equipped' : ''}" onclick="_gameToggleEquip(${item.id || item.item_id}, '${item.type || 'badge'}', ${isEquipped})">
            <div class="game-inv-icon">${item.icon || '?'}</div>
            <div class="game-inv-name">${item.name || ''}</div>
            ${isEquipped ? '<div class="game-inv-badge">Активно</div>' : ''}
        </div>`;
    }).join('');

    return `<div class="game-inv-grid">${html}</div>`;
}

function _renderGameShop(shop, coins) {
    if (!shop || !Array.isArray(shop) || shop.length === 0) {
        return '<div class="profile-empty">Магазин порожній</div>';
    }

    const items = shop;
    const html = items.map(item => {
        const owned = item.owned;
        const canBuy = !owned && coins >= (item.price_coins || 0);
        const featured = item.is_featured ? 'featured' : '';
        return `<div class="game-shop-item ${featured} ${owned ? 'owned' : ''}">
            <div class="game-shop-icon">${item.icon || '?'}</div>
            <div class="game-shop-body">
                <div class="game-shop-name">${item.name || ''}</div>
                <div class="game-shop-desc">${item.description || ''}</div>
                <div class="game-shop-price">${item.price_coins || 0} <span class="game-coin-icon">&#x1FA99;</span></div>
            </div>
            <div class="game-shop-action">
                ${owned ? '<span class="game-shop-owned">Придбано</span>' :
                  `<button class="game-shop-buy ${canBuy ? '' : 'disabled'}" onclick="_gameBuyItem(${item.id})" ${canBuy ? '' : 'disabled'}>Купити</button>`}
            </div>
        </div>`;
    }).join('');

    return html;
}

function _renderGameLeaderboard(leaderboard) {
    if (!leaderboard || !Array.isArray(leaderboard) || leaderboard.length === 0) {
        return '<div class="profile-empty">Лідерборд порожній</div>';
    }

    const items = leaderboard;
    const medalColors = ['#FBBF24', '#CBD5E0', '#CD7F32'];
    const currentUser = AppState.currentUser?.username;

    const html = items.map((u, i) => {
        const medal = i < 3 ? `<span style="color:${medalColors[i]}; font-size:18px">${['&#x1F947;','&#x1F948;','&#x1F949;'][i]}</span>` : `<span class="game-lb-rank">${i + 1}</span>`;
        const isMe = u.username === currentUser;
        return `<div class="game-lb-row ${isMe ? 'me' : ''}">
            ${medal}
            <div class="game-lb-name">${u.display_name || u.username}${isMe ? ' (ви)' : ''}</div>
            <div class="game-lb-stats">
                <span class="game-lb-xp">Lv.${u.level || 1}</span>
                <span class="game-lb-val">${u.xp || 0} XP</span>
            </div>
        </div>`;
    }).join('');

    // Sort buttons
    const sortBtns = `<div class="game-lb-sort">
        <button class="game-sub-tab active" onclick="_gameLeaderboardSort('xp')">XP</button>
        <button class="game-sub-tab" onclick="_gameLeaderboardSort('coins')">Монети</button>
        <button class="game-sub-tab" onclick="_gameLeaderboardSort('achievements')">Досягнення</button>
    </div>`;

    return sortBtns + html;
}

async function _gameBuyItem(shopItemId) {
    const result = await apiGamificationBuy(shopItemId);
    if (result.success) {
        if (typeof showNotification === 'function') showNotification('Придбано!', 'success');
        // Refresh game tab
        const container = document.getElementById('profTabContent');
        if (container && window._profileData) _profileTabGame(container, window._profileData);
    } else {
        if (typeof showNotification === 'function') showNotification(result.error || 'Помилка покупки', 'error');
    }
}

async function _gameToggleEquip(itemId, type, isEquipped) {
    let result;
    if (isEquipped) {
        result = await apiGamificationUnequip(type);
    } else {
        result = await apiGamificationEquip(itemId);
    }
    if (result.success) {
        const container = document.getElementById('profTabContent');
        if (container && window._profileData) _profileTabGame(container, window._profileData);
    }
}

async function _gameLeaderboardSort(sortBy) {
    const lb = await apiGamificationLeaderboard(sortBy);
    if (lb && _gameTabData) {
        _gameTabData.leaderboard = lb;
        _gameSubTab = 'leaderboard';
        const container = document.getElementById('profTabContent');
        if (container) _renderGameTab(container);
    }
}

// Quick status change from profile
async function profileQuickStatus(taskId, status) {
    const btn = event.target;
    btn.disabled = true;
    btn.style.opacity = '0.5';
    if (typeof apiLogAction === 'function') apiLogAction('quick_task_status', `task_${taskId}`, { status });
    const result = await apiQuickTaskStatus(taskId, status);
    if (result.success) {
        // Re-render by removing the task row or updating icon
        const row = document.querySelector(`[data-task-id="${taskId}"]`);
        if (row) {
            row.style.transition = 'opacity 0.3s, transform 0.3s';
            row.style.opacity = '0';
            row.style.transform = 'translateX(20px)';
            setTimeout(() => row.remove(), 300);
        }
        // Update day progress if visible
        const dp = window._profileData?.dayProgress;
        if (dp && status === 'done') {
            dp.tasksDoneToday++;
            dp.tasksRemaining = Math.max(0, dp.tasksRemaining - 1);
        }
    } else {
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

function profileShowPasswordForm() {
    const form = document.getElementById('profilePasswordForm');
    if (form) {
        form.classList.remove('hidden');
        document.getElementById('profileCurrentPwd').focus();
    }
}

async function profileChangePassword() {
    const current = document.getElementById('profileCurrentPwd').value;
    const newPwd = document.getElementById('profileNewPwd').value;
    const errEl = document.getElementById('profilePwdError');
    const okEl = document.getElementById('profilePwdSuccess');
    errEl.classList.add('hidden');
    okEl.classList.add('hidden');

    if (!current || !newPwd) {
        errEl.textContent = 'Заповніть обидва поля';
        errEl.classList.remove('hidden');
        return;
    }
    if (newPwd.length < 6) {
        errEl.textContent = 'Мінімум 6 символів';
        errEl.classList.remove('hidden');
        return;
    }

    const result = await apiChangePassword(current, newPwd);
    if (result.success) {
        okEl.textContent = 'Пароль змінено!';
        okEl.classList.remove('hidden');
        document.getElementById('profileCurrentPwd').value = '';
        document.getElementById('profileNewPwd').value = '';
        setTimeout(() => {
            document.getElementById('profilePasswordForm').classList.add('hidden');
            okEl.classList.add('hidden');
        }, 2000);
    } else {
        errEl.textContent = result.error || 'Помилка зміни пароля';
        errEl.classList.remove('hidden');
    }
}

async function profileLoadMoreActivity() {
    const list = document.getElementById('profileActivityList');
    const btn = document.querySelector('.btn-profile-load-more');
    if (!list) return;

    const offset = window._profileActivityOffset || 0;
    const data = await apiGetProfileActivity({ limit: 20, offset });
    if (!data || !data.items || data.items.length === 0) {
        if (btn) btn.textContent = 'Більше немає';
        return;
    }

    list.insertAdjacentHTML('beforeend', profileRenderActivityItems(data.items));
    window._profileActivityOffset = offset + data.items.length;
    if (data.items.length < 20 && btn) btn.remove();
}

// v22.5: Daily login reward check
async function checkDailyLogin() {
    try {
        const token = localStorage.getItem('pzp_token');
        if (!token) return;
        const r = await fetch('/api/wallet/daily-login', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
        });
        if (!r.ok) return;
        const data = await r.json();
        if (data.alreadyClaimed) return;
        showDailyLoginPopup(data);
    } catch (e) { /* silent */ }
}

function showDailyLoginPopup(data) {
    const REWARDS = [10, 15, 20, 25, 30, 40, 50];
    let streakHtml = '';
    for (let i = 0; i < 7; i++) {
        const isClaimed = i < data.dayIndex - 1;
        const isToday = i === data.dayIndex - 1;
        streakHtml += `
        <div class="streak-day ${isClaimed ? 'claimed' : ''} ${isToday ? 'today' : ''}">
            <div class="streak-coins">${REWARDS[i]}</div>
            <div class="streak-label">Д${i + 1}</div>
        </div>`;
    }

    const popup = document.createElement('div');
    popup.className = 'daily-login-popup';
    popup.innerHTML = `
    <div class="daily-login-card">
        <div class="daily-login-title">Щоденний бонус!</div>
        <div class="daily-login-subtitle">День ${data.loginStreak} серії</div>
        <div class="daily-streak-row">${streakHtml}</div>
        <div class="daily-login-reward">+${data.reward} монет</div>
        ${data.bonusItem ? `<div class="daily-login-bonus">Бонус: ${data.bonusItem}!</div>` : ''}
        <button class="daily-login-close" onclick="this.closest('.daily-login-popup').remove()">Забрати</button>
    </div>`;
    document.body.appendChild(popup);

    // Auto-close after 10s
    setTimeout(() => { if (popup.parentNode) popup.remove(); }, 10000);
}

// v10.4: Auto-init profile handler on any page (sub-pages don't call showMainApp)
function initProfileHandler() {
    const el = document.getElementById('currentUser');
    if (!el || el.dataset.profileInit) return;
    el.dataset.profileInit = '1';
    el.classList.add('user-name-clickable');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('title', 'Особистий кабінет');
    el.addEventListener('click', openProfileModal);
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfileModal(); }
    });

    // Init modal close for sub-pages that don't include app.js
    const profileModal = document.getElementById('profileModal');
    if (profileModal) {
        const closeBtn = profileModal.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                profileModal.classList.add('hidden');
            });
        }
        profileModal.addEventListener('click', (e) => {
            if (e.target === profileModal) profileModal.classList.add('hidden');
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !profileModal.classList.contains('hidden')) {
                profileModal.classList.add('hidden');
            }
        });
    }
}

// Run on DOMContentLoaded + MutationObserver for sub-pages that set currentUser later
document.addEventListener('DOMContentLoaded', () => {
    // Delay slightly to let page-specific JS set username first
    setTimeout(initProfileHandler, 100);
});
