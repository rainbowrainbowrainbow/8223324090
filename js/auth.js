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
        return true;
    } catch (err) {
        console.error('Login error:', err);
        return false;
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
}

function isViewer() {
    return AppState.currentUser && AppState.currentUser.role === 'viewer';
}

// v7.1: Can manage products (admin or manager)
function canManageProducts() {
    return AppState.currentUser && (AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'manager');
}

function isAdmin() {
    return AppState.currentUser && AppState.currentUser.role === 'admin';
}

function showMainApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('currentUser').textContent = AppState.currentUser.name;

    // v8.6: Close all panels/modals on page load to prevent stale empty views
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    ['certificatesPanel', 'bookingPanel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    document.body.classList.remove('panel-open');
    const backdrop = document.getElementById('panelBackdrop');
    if (backdrop) backdrop.classList.add('hidden');

    // Settings (gear) — тільки для адмінів
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.classList.toggle('hidden', AppState.currentUser.role !== 'admin');
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

    // Viewer: сховати кнопки редагування
    if (isViewer()) {
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

    // v10.3: Personal cabinet — click on username
    const userNameEl = document.getElementById('currentUser');
    if (userNameEl) {
        userNameEl.addEventListener('click', openProfileModal);
        userNameEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfileModal(); }
        });
    }
}

// v10.3: Personal cabinet
async function openProfileModal() {
    const modal = document.getElementById('profileModal');
    const content = document.getElementById('profileContent');
    if (!modal || !content) return;

    modal.classList.remove('hidden');
    content.innerHTML = '<div class="profile-loading">Завантаження...</div>';

    const data = await apiGetProfile();
    if (!data) {
        content.innerHTML = '<div class="profile-error">Не вдалося завантажити дані</div>';
        return;
    }

    const roleNames = { admin: 'Адміністратор', user: 'Користувач', viewer: 'Глядач' };
    const roleName = roleNames[data.user.role] || data.user.role;
    const createdAt = new Date(data.user.createdAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });

    const actionNames = {
        create: 'Створення', edit: 'Редагування', delete: 'Видалення', confirm: 'Підтвердження',
        cancel: 'Скасування', afisha_create: 'Афіша +', afisha_edit: 'Афіша ред.',
        afisha_delete: 'Афіша —', tasks_generated: 'Задачі згенер.', recurring_create: 'Recurring',
        afisha_move: 'Переміщення', duplicate: 'Дублювання'
    };

    let activityHTML = '';
    if (data.recentActivity.length > 0) {
        activityHTML = data.recentActivity.map(a => {
            const actionLabel = actionNames[a.action] || a.action;
            const time = new Date(a.created_at).toLocaleString('uk-UA', {
                timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            });
            let detail = '';
            try {
                const d = typeof a.data === 'string' ? JSON.parse(a.data) : a.data;
                detail = d.label || d.title || d.program || d.bookingId || '';
            } catch { /* ignore */ }
            return `<div class="profile-activity-item"><span class="profile-activity-action">${actionLabel}</span><span class="profile-activity-detail">${detail}</span><span class="profile-activity-time">${time}</span></div>`;
        }).join('');
    } else {
        activityHTML = '<div class="profile-empty">Немає активності</div>';
    }

    content.innerHTML = `
        <div class="profile-header">
            <div class="profile-avatar">${data.user.name.charAt(0).toUpperCase()}</div>
            <div class="profile-info">
                <div class="profile-name">${data.user.name}</div>
                <div class="profile-role">${roleName}</div>
                <div class="profile-since">З ${createdAt}</div>
            </div>
        </div>

        <div class="profile-stats">
            <div class="profile-stat">
                <div class="profile-stat-value">${data.bookingsCreated}</div>
                <div class="profile-stat-label">Бронювань</div>
            </div>
            <div class="profile-stat">
                <div class="profile-stat-value">${data.tasks.total || 0}</div>
                <div class="profile-stat-label">Задач</div>
            </div>
            <div class="profile-stat">
                <div class="profile-stat-value">${data.tasks.done || 0}</div>
                <div class="profile-stat-label">Виконано</div>
            </div>
            <div class="profile-stat">
                <div class="profile-stat-value">${data.points.permanentTotal}</div>
                <div class="profile-stat-label">Балів</div>
            </div>
        </div>

        <div class="profile-section">
            <h4>Бали за ${data.points.month}</h4>
            <div class="profile-points-row">
                <span>Місячні</span>
                <span class="profile-points-val ${data.points.monthly >= 0 ? 'positive' : 'negative'}">${data.points.monthly > 0 ? '+' : ''}${data.points.monthly}</span>
            </div>
            <div class="profile-points-row">
                <span>Постійні (всього)</span>
                <span class="profile-points-val positive">+${data.points.permanentTotal}</span>
            </div>
        </div>

        <div class="profile-section">
            <h4>Задачі</h4>
            <div class="profile-tasks-grid">
                <div class="profile-task-chip todo">${data.tasks.assigned || 0} очікує</div>
                <div class="profile-task-chip progress">${data.tasks.in_progress || 0} в роботі</div>
                <div class="profile-task-chip done">${data.tasks.done || 0} завершено</div>
            </div>
        </div>

        <div class="profile-section">
            <h4>Остання активність</h4>
            <div class="profile-activity">${activityHTML}</div>
        </div>
    `;
}
