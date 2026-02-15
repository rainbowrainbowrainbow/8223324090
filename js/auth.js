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

// v10.4: Personal cabinet — full version
const PROFILE_ACTION_NAMES = {
    create: 'Створення', edit: 'Редагування', delete: 'Видалення', confirm: 'Підтвердження',
    cancel: 'Скасування', afisha_create: 'Афіша +', afisha_edit: 'Афіша ред.',
    afisha_delete: 'Афіша —', tasks_generated: 'Задачі згенер.', recurring_create: 'Recurring',
    afisha_move: 'Переміщення', duplicate: 'Дублювання', certificate_create: 'Сертифікат +',
    certificate_used: 'Сертифікат використ.', certificate_revoked: 'Сертифікат скасов.'
};

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

    const roleNames = { admin: 'Адміністратор', user: 'Користувач', viewer: 'Глядач', manager: 'Менеджер' };
    const roleName = roleNames[data.user.role] || data.user.role;
    const createdAt = new Date(data.user.createdAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
    const tgStatus = data.user.telegramConnected;

    // Stats cards: 5 items
    const rank = data.leaderboard.rank ? `#${data.leaderboard.rank}` : '—';

    // Attention section (overdue + upcoming)
    let attentionHTML = '';
    const attentionItems = [];
    if (data.tasks.overdue > 0) {
        attentionItems.push(`<div class="profile-attention-item danger">${data.tasks.overdue} прострочен${data.tasks.overdue === 1 ? 'а' : 'их'} задач${data.tasks.overdue === 1 ? 'а' : ''}</div>`);
    }
    if (data.tasks.upcoming && data.tasks.upcoming.length > 0) {
        data.tasks.upcoming.forEach(t => {
            const dl = new Date(t.deadline);
            const mins = Math.round((dl - new Date()) / 60000);
            const timeStr = mins < 60 ? `${mins} хв` : `${Math.round(mins / 60)} год`;
            attentionItems.push(`<div class="profile-attention-item warning">Дедлайн через ${timeStr}: ${t.title}</div>`);
        });
    }
    if (attentionItems.length > 0) {
        attentionHTML = `<div class="profile-section profile-attention"><h4>Потребують уваги</h4>${attentionItems.join('')}</div>`;
    }

    // My tasks list
    let myTasksHTML = '';
    if (data.myTasks && data.myTasks.length > 0) {
        const taskItems = data.myTasks.map(t => {
            const icon = t.status === 'in_progress' ? '◉' : (t.isOverdue ? '⚠' : '○');
            const cls = t.isOverdue ? 'overdue' : t.status;
            const deadlineStr = t.deadline ? profileFormatTime(t.deadline) : '';
            const priorityCls = t.priority === 'critical' || t.priority === 'high' ? 'high-priority' : '';
            return `<div class="profile-task-item ${cls} ${priorityCls}"><span class="profile-task-icon">${icon}</span><span class="profile-task-title">${t.title}</span><span class="profile-task-deadline">${deadlineStr}</span></div>`;
        }).join('');
        myTasksHTML = `<div class="profile-section"><h4>Мої задачі</h4><div class="profile-tasks-list">${taskItems}</div></div>`;
    }

    // Points section with transactions
    let pointsHTML = '';
    const monthName = new Date(data.points.month + '-01').toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
    let txHTML = '';
    if (data.pointTransactions && data.pointTransactions.length > 0) {
        txHTML = data.pointTransactions.map(tx => {
            const sign = tx.points > 0 ? '+' : '';
            const cls = tx.points >= 0 ? 'positive' : 'negative';
            const reasonMap = { ON_TIME: 'Вчасно', EARLY: 'Раніше строку', HIGH_PRIORITY: 'Пріоритетна', LATE_MINOR: 'Невелике запізн.', LATE_MAJOR: 'Значне запізн.', NO_STATUS_UPDATE: 'Без оновлення', manual: 'Ручне' };
            const reasonLabel = reasonMap[tx.reason] || tx.reason || '';
            const time = profileFormatTime(tx.created_at);
            return `<div class="profile-points-row"><span>${reasonLabel}</span><span class="profile-points-val ${cls}">${sign}${tx.points}</span></div>`;
        }).join('');
    }
    pointsHTML = `
        <div class="profile-section">
            <h4>Бали за ${monthName}</h4>
            <div class="profile-points-row"><span>Місячні</span><span class="profile-points-val ${data.points.monthly >= 0 ? 'positive' : 'negative'}">${data.points.monthly > 0 ? '+' : ''}${data.points.monthly}</span></div>
            <div class="profile-points-row"><span>Постійні (всього)</span><span class="profile-points-val positive">+${data.points.permanentTotal}</span></div>
            ${txHTML ? '<div class="profile-tx-divider">Останні нарахування</div>' + txHTML : ''}
        </div>`;

    // Tasks stats section
    let taskStatsHTML = `
        <div class="profile-section">
            <h4>Задачі</h4>
            <div class="profile-tasks-grid">
                <div class="profile-task-chip todo">${data.tasks.assigned || 0} очікує</div>
                <div class="profile-task-chip progress">${data.tasks.in_progress || 0} в роботі</div>
                <div class="profile-task-chip done">${data.tasks.done || 0} завершено</div>
                ${data.tasks.overdue > 0 ? `<div class="profile-task-chip overdue">${data.tasks.overdue} прострочено</div>` : ''}
            </div>
            ${data.tasks.avgCompletionHours !== null ? `<div class="profile-stat-row">Серед. час виконання: <strong>${data.tasks.avgCompletionHours} год</strong></div>` : ''}
            ${data.tasks.escalations > 0 ? `<div class="profile-stat-row">Ескалацій: <strong>${data.tasks.escalations}</strong></div>` : ''}
            ${data.tasks.byCategory && data.tasks.byCategory.length > 0 ? `<div class="profile-stat-row">По категоріях: ${data.tasks.byCategory.map(c => `<span class="profile-cat-chip">${c.category} (${c.count})</span>`).join(' ')}</div>` : ''}
        </div>`;

    // Bookings section
    let bookingsHTML = '';
    const bk = data.bookings;
    if (bk) {
        const confirmed = bk.byStatus.confirmed || 0;
        const preliminary = bk.byStatus.preliminary || 0;
        const cancelled = bk.byStatus.cancelled || 0;
        let topProgsHTML = '';
        if (bk.topPrograms && bk.topPrograms.length > 0) {
            topProgsHTML = `<div class="profile-stat-row">Топ: ${bk.topPrograms.map(p => `${p.program_name} (${p.count})`).join(', ')}</div>`;
        }
        bookingsHTML = `
            <div class="profile-section">
                <h4>Бронювання</h4>
                <div class="profile-booking-stats">
                    <div class="profile-points-row"><span>Підтверджених</span><span class="profile-points-val positive">${confirmed}</span></div>
                    <div class="profile-points-row"><span>Попередніх</span><span class="profile-points-val">${preliminary}</span></div>
                    ${cancelled > 0 ? `<div class="profile-points-row"><span>Скасованих</span><span class="profile-points-val negative">${cancelled}</span></div>` : ''}
                    ${data.showRevenue ? `<div class="profile-points-row"><span>Виручка</span><span class="profile-points-val positive">${bk.revenue.toLocaleString('uk-UA')} ₴</span></div>` : ''}
                </div>
                ${topProgsHTML}
            </div>`;
    }

    // Certificates section
    let certsHTML = '';
    if (data.certificates && data.certificates.total > 0) {
        const cert = data.certificates;
        certsHTML = `
            <div class="profile-section">
                <h4>Сертифікати видані</h4>
                <div class="profile-points-row"><span>Всього</span><span class="profile-points-val">${cert.total}</span></div>
                ${cert.byStatus.active ? `<div class="profile-points-row"><span>Активних</span><span class="profile-points-val positive">${cert.byStatus.active}</span></div>` : ''}
                ${cert.byStatus.used ? `<div class="profile-points-row"><span>Використаних</span><span class="profile-points-val">${cert.byStatus.used}</span></div>` : ''}
            </div>`;
    }

    // Activity section with load more
    const activityItemsHTML = profileRenderActivityItems(data.recentActivity);

    // Settings section
    const settingsHTML = `
        <div class="profile-section profile-settings">
            <h4>Налаштування</h4>
            <div class="profile-settings-grid">
                <button class="btn-profile-action" onclick="profileShowPasswordForm()">Змінити пароль</button>
                <div class="profile-tg-status">Telegram: <span class="${tgStatus ? 'connected' : 'disconnected'}">${tgStatus ? 'підключено' : 'не підключено'}</span></div>
            </div>
            <div id="profilePasswordForm" class="profile-password-form hidden">
                <input type="password" id="profileCurrentPwd" placeholder="Поточний пароль" autocomplete="current-password">
                <input type="password" id="profileNewPwd" placeholder="Новий пароль (мін. 6 символів)" autocomplete="new-password">
                <div class="profile-pwd-actions">
                    <button class="btn-profile-save" onclick="profileChangePassword()">Зберегти</button>
                    <button class="btn-profile-cancel" onclick="document.getElementById('profilePasswordForm').classList.add('hidden')">Скасувати</button>
                </div>
                <div id="profilePwdError" class="profile-pwd-error hidden"></div>
                <div id="profilePwdSuccess" class="profile-pwd-success hidden"></div>
            </div>
        </div>`;

    content.innerHTML = `
        <div class="profile-header">
            <div class="profile-avatar">${data.user.name.charAt(0).toUpperCase()}</div>
            <div class="profile-info">
                <div class="profile-name">${data.user.name}</div>
                <div class="profile-role">${roleName}</div>
                <div class="profile-since">З ${createdAt}</div>
                <div class="profile-tg-badge ${tgStatus ? 'connected' : ''}">${tgStatus ? 'TG' : 'TG —'}</div>
            </div>
        </div>

        <div class="profile-stats">
            <div class="profile-stat">
                <div class="profile-stat-value">${bk ? bk.total : 0}</div>
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
            <div class="profile-stat">
                <div class="profile-stat-value">${rank}</div>
                <div class="profile-stat-label">Ранг</div>
            </div>
        </div>

        ${attentionHTML}
        ${myTasksHTML}
        ${pointsHTML}
        ${taskStatsHTML}
        ${bookingsHTML}
        ${certsHTML}

        <div class="profile-section">
            <h4>Остання активність</h4>
            <div id="profileActivityList" class="profile-activity">${activityItemsHTML}</div>
            ${data.recentActivity.length >= 20 ? '<button class="btn-profile-load-more" onclick="profileLoadMoreActivity()">Показати ще</button>' : ''}
        </div>

        ${settingsHTML}
    `;

    // Store state for pagination
    window._profileActivityOffset = data.recentActivity.length;
    window._profileActivityFilter = '';
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
