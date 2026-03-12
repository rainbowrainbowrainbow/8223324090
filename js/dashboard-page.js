/**
 * js/dashboard-page.js — Dashboard page logic (v22.0.0)
 * Widget-based personalized dashboard
 */

const DashboardPage = (() => {
    // Widget definitions
    const WIDGET_DEFS = {
        quick_stats:    { icon: '📊', title: 'Швидка статистика', minRole: 'admin' },
        tasks:          { icon: '📋', title: 'Мої задачі', minRole: null },
        bookings_today: { icon: '📅', title: 'Бронювання сьогодні', minRole: 'admin' },
        my_schedule:    { icon: '🕐', title: 'Мій графік', minRole: null },
        team_online:    { icon: '👥', title: 'Команда онлайн', minRole: 'manager' },
        weather:        { icon: '🌤', title: 'Погода', minRole: null },
        currency:       { icon: '💱', title: 'Курси валют', minRole: 'manager' },
        announcements:  { icon: '📢', title: 'Оголошення', minRole: null },
    };

    let _config = null;
    let _widgetData = {};

    async function init() {
        const token = localStorage.getItem('pzp_token');
        if (!token) {
            window.location.href = '/';
            return;
        }

        // Set username
        const savedUser = localStorage.getItem('pzp_current_user');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                AppState.currentUser = user;
                const el = document.getElementById('currentUser');
                if (el) el.textContent = user.name;
            } catch {}
        }

        // Verify session
        const verified = await apiVerifyToken();
        if (!verified) {
            window.location.href = '/';
            return;
        }
        AppState.currentUser = verified;
        const el = document.getElementById('currentUser');
        if (el) el.textContent = verified.name;

        // Load config
        await loadConfig();

        // Init test panel for creator
        initTestPanel();

        // Render greeting
        renderGreeting();
    }

    async function loadConfig() {
        try {
            const resp = await fetch('/api/dashboard/config', {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
            });
            const data = await resp.json();

            if (data.success) {
                _config = data.config;
                renderWidgets();
            }
        } catch (err) {
            console.error('Dashboard config error:', err);
            // Render with defaults
            _config = { widgets: ['tasks', 'my_schedule', 'weather'], layout: {}, theme: 'default' };
            renderWidgets();
        }
    }

    function renderGreeting() {
        const greetingEl = document.getElementById('dashboardGreeting');
        if (!greetingEl || !AppState.currentUser) return;

        const hour = new Date().getHours();
        let greeting = 'Привіт';
        if (hour < 6) greeting = 'Доброї ночі';
        else if (hour < 12) greeting = 'Доброго ранку';
        else if (hour < 18) greeting = 'Доброго дня';
        else greeting = 'Доброго вечора';

        const role = getUserRole();
        const roleName = ROLE_NAMES[role] || role;
        greetingEl.textContent = `${greeting}, ${AppState.currentUser.name}! (${roleName})`;
    }

    function renderWidgets() {
        const grid = document.getElementById('dashboardGrid');
        if (!grid || !_config) return;

        const widgets = _config.widgets || [];
        grid.innerHTML = '';

        for (const widgetKey of widgets) {
            const def = WIDGET_DEFS[widgetKey];
            if (!def) continue;

            // Check role access
            if (def.minRole && typeof hasMinRole === 'function' && !hasMinRole(def.minRole)) {
                continue;
            }

            const card = document.createElement('div');
            card.className = 'widget-card';
            card.dataset.widget = widgetKey;
            card.innerHTML = `
                <div class="widget-header">
                    <div class="widget-title">
                        <span class="widget-title-icon">${def.icon}</span>
                        ${def.title}
                    </div>
                    <div class="widget-actions">
                        <button class="widget-action-btn" onclick="DashboardPage.refreshWidget('${widgetKey}')" title="Оновити">↻</button>
                    </div>
                </div>
                <div class="widget-body" id="widget-${widgetKey}">
                    <div class="widget-loading">Завантаження...</div>
                </div>
            `;
            grid.appendChild(card);

            // Load widget data
            loadWidgetData(widgetKey);
        }

        if (grid.children.length === 0) {
            grid.innerHTML = '<div class="widget-empty">Немає віджетів. Натисніть "Налаштувати" щоб додати.</div>';
        }
    }

    async function loadWidgetData(type) {
        const container = document.getElementById(`widget-${type}`);
        if (!container) return;

        try {
            const resp = await fetch(`/api/dashboard/widgets/${type}`, {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
            });
            const result = await resp.json();

            if (result.success) {
                _widgetData[type] = result.data;
                renderWidgetContent(type, result.data, container);
            } else {
                container.innerHTML = '<div class="widget-empty">Помилка завантаження</div>';
            }
        } catch {
            container.innerHTML = '<div class="widget-empty">Помилка з\'єднання</div>';
        }
    }

    function renderWidgetContent(type, data, container) {
        switch (type) {
            case 'quick_stats':
                renderQuickStats(data, container);
                break;
            case 'tasks':
                renderTasks(data, container);
                break;
            case 'bookings_today':
                renderBookings(data, container);
                break;
            case 'my_schedule':
                renderSchedule(data, container);
                break;
            case 'team_online':
                renderTeamOnline(data, container);
                break;
            case 'weather':
                renderWeather(data, container);
                break;
            case 'currency':
                renderCurrency(data, container);
                break;
            case 'announcements':
                renderAnnouncements(data, container);
                break;
            default:
                container.innerHTML = '<div class="widget-empty">Невідомий віджет</div>';
        }
    }

    function renderQuickStats(data, container) {
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value">${data.bookingsToday || 0}</div>
                    <div class="stat-label">Бронювань</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${data.activeTasks || 0}</div>
                    <div class="stat-label">Активних задач</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${formatCurrency(data.revenueToday || 0)}</div>
                    <div class="stat-label">Виручка</div>
                </div>
            </div>
        `;
    }

    function renderTasks(data, container) {
        if (!data.tasks || data.tasks.length === 0) {
            container.innerHTML = '<div class="widget-empty">Немає активних задач</div>';
            return;
        }

        const items = data.tasks.slice(0, 6).map(t => {
            const priorityCls = t.priority || 'medium';
            const deadline = t.deadline ? formatDeadline(t.deadline) : '';
            return `<div class="widget-task-item">
                <div class="widget-task-icon ${priorityCls}"></div>
                <div class="widget-task-title">${escapeHtml(t.title)}</div>
                ${deadline ? `<div class="widget-task-deadline">${deadline}</div>` : ''}
            </div>`;
        }).join('');

        container.innerHTML = `<div class="widget-task-list">${items}</div>`;
    }

    function renderBookings(data, container) {
        if (!data.bookings || data.bookings.length === 0) {
            container.innerHTML = '<div class="widget-empty">Немає бронювань на сьогодні</div>';
            return;
        }

        const items = data.bookings.slice(0, 6).map(b => {
            const time = b.start_time ? b.start_time.substring(0, 5) : '';
            const statusCls = b.status || 'preliminary';
            const statusLabel = b.status === 'confirmed' ? 'Підтв.' : 'Попер.';
            return `<div class="widget-booking-item">
                <div class="widget-booking-time">${time}</div>
                <div class="widget-booking-info">
                    <div class="widget-booking-name">${escapeHtml(b.client_name || '')}</div>
                    <div class="widget-booking-program">${escapeHtml(b.program || '')} · ${b.children_count || 0} діт.</div>
                </div>
                <span class="widget-booking-status ${statusCls}">${statusLabel}</span>
            </div>`;
        }).join('');

        container.innerHTML = items;
    }

    function renderSchedule(data, container) {
        if (!data.shifts || data.shifts.length === 0) {
            container.innerHTML = '<div class="widget-empty">Немає запланованих змін</div>';
            return;
        }

        const statusMap = { working: 'На зміні', dayoff: 'Вихідний', vacation: 'Відпустка', sick: 'Лікарняний' };
        const items = data.shifts.map(s => {
            const date = new Date(s.date).toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' });
            const statusLabel = statusMap[s.status] || s.status;
            const statusCls = s.status === 'working' ? 'working' : 'dayoff';
            const timeStr = s.start_time && s.end_time ? `${s.start_time.substring(0,5)}–${s.end_time.substring(0,5)}` : '';
            return `<div class="schedule-item">
                <div class="schedule-date">${date}</div>
                <div class="schedule-status ${statusCls}">${statusLabel}</div>
                ${timeStr ? `<div style="font-size:12px;color:var(--gray-500)">${timeStr}</div>` : ''}
            </div>`;
        }).join('');

        container.innerHTML = items;
    }

    function renderTeamOnline(data, container) {
        if (!data.online || data.online.length === 0) {
            container.innerHTML = '<div class="widget-empty">Ніхто не онлайн</div>';
            return;
        }

        const items = data.online.map(m => {
            const initial = (m.name || '?').charAt(0).toUpperCase();
            return `<div class="team-member">
                <div class="team-avatar">${initial}</div>
                ${escapeHtml(m.name)}
                <div class="team-online-dot"></div>
            </div>`;
        }).join('');

        container.innerHTML = `<div class="team-grid">${items}</div>`;
    }

    function renderWeather(data, container) {
        if (data.error) {
            container.innerHTML = `<div class="widget-empty">${data.error}</div>`;
            return;
        }

        const weatherIcons = {
            0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️', 45: '🌫', 48: '🌫',
            51: '🌦', 53: '🌧', 55: '🌧', 61: '🌧', 63: '🌧', 65: '🌧',
            71: '🌨', 73: '🌨', 75: '❄️', 80: '🌦', 81: '🌧', 82: '⛈',
            95: '⛈', 96: '⛈', 99: '⛈'
        };
        const icon = weatherIcons[data.weatherCode] || '🌡';

        container.innerHTML = `
            <div class="weather-display">
                <div class="weather-icon">${icon}</div>
                <div>
                    <div class="weather-temp">${Math.round(data.temperature || 0)}°</div>
                    <div class="weather-details">${data.city || 'Київ'} · Вітер ${data.windSpeed || 0} км/г</div>
                </div>
            </div>
        `;
    }

    function renderCurrency(data, container) {
        if (data.error) {
            container.innerHTML = `<div class="widget-empty">${data.error}</div>`;
            return;
        }

        container.innerHTML = `
            <div class="currency-rates">
                <div class="currency-item">
                    <div class="currency-code">USD</div>
                    <div class="currency-value">${data.usd ? data.usd.toFixed(2) : '—'}</div>
                    <div class="currency-unit">₴</div>
                </div>
                <div class="currency-item">
                    <div class="currency-code">EUR</div>
                    <div class="currency-value">${data.eur ? data.eur.toFixed(2) : '—'}</div>
                    <div class="currency-unit">₴</div>
                </div>
            </div>
        `;
    }

    function renderAnnouncements(data, container) {
        if (!data.announcements || data.announcements.length === 0) {
            container.innerHTML = '<div class="widget-empty">Немає оголошень</div>';
            return;
        }

        const items = data.announcements.map(a => {
            const priorityCls = a.priority === 'high' ? 'high' : '';
            const date = new Date(a.created_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
            return `<div class="announcement-item ${priorityCls}">
                <div class="announcement-title">${escapeHtml(a.title || '')}</div>
                <div class="announcement-content">${escapeHtml(a.content || '')}</div>
                <div class="announcement-meta">${date} · ${escapeHtml(a.author_name || '')}</div>
            </div>`;
        }).join('');

        container.innerHTML = items;
    }

    // Onboarding wizard
    function showOnboarding() {
        const overlay = document.createElement('div');
        overlay.className = 'onboarding-overlay';
        overlay.id = 'onboardingOverlay';

        const role = getUserRole();
        const availableWidgets = Object.entries(WIDGET_DEFS)
            .filter(([, def]) => !def.minRole || (typeof hasMinRole === 'function' && hasMinRole(def.minRole)));

        const widgetOptions = availableWidgets.map(([key, def]) => {
            const isDefault = _config && _config.widgets && _config.widgets.includes(key);
            return `<div class="onboarding-widget-option ${isDefault ? 'selected' : ''}" data-widget="${key}" onclick="DashboardPage.toggleOnboardingWidget(this)">
                <div class="onboarding-widget-icon">${def.icon}</div>
                <div class="onboarding-widget-label">${def.title}</div>
            </div>`;
        }).join('');

        overlay.innerHTML = `
            <div class="onboarding-modal">
                <h2>Налаштуйте дашборд</h2>
                <p>Оберіть віджети, які хочете бачити на головній сторінці</p>
                <div class="onboarding-widgets">${widgetOptions}</div>
                <button class="dashboard-btn primary" onclick="DashboardPage.saveOnboarding()" style="width:100%">Зберегти</button>
            </div>
        `;

        document.body.appendChild(overlay);
    }

    function toggleOnboardingWidget(el) {
        el.classList.toggle('selected');
    }

    async function saveOnboarding() {
        const selected = [];
        document.querySelectorAll('.onboarding-widget-option.selected').forEach(el => {
            selected.push(el.dataset.widget);
        });

        if (selected.length === 0) {
            selected.push('tasks', 'weather');
        }

        _config.widgets = selected;

        try {
            await fetch('/api/dashboard/config', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + localStorage.getItem('pzp_token')
                },
                body: JSON.stringify({ widgets: selected, layout: {}, theme: 'default' })
            });
        } catch {}

        const overlay = document.getElementById('onboardingOverlay');
        if (overlay) overlay.remove();

        renderWidgets();
    }

    // Settings modal
    function openSettings() {
        const role = getUserRole();
        const availableWidgets = Object.entries(WIDGET_DEFS)
            .filter(([, def]) => !def.minRole || (typeof hasMinRole === 'function' && hasMinRole(def.minRole)));

        const activeWidgets = _config ? (_config.widgets || []) : [];

        const widgetOptions = availableWidgets.map(([key, def]) => {
            const isActive = activeWidgets.includes(key);
            return `<div class="onboarding-widget-option ${isActive ? 'selected' : ''}" data-widget="${key}" onclick="DashboardPage.toggleOnboardingWidget(this)">
                <div class="onboarding-widget-icon">${def.icon}</div>
                <div class="onboarding-widget-label">${def.title}</div>
            </div>`;
        }).join('');

        const overlay = document.createElement('div');
        overlay.className = 'onboarding-overlay';
        overlay.id = 'onboardingOverlay';
        overlay.innerHTML = `
            <div class="onboarding-modal">
                <h2>Налаштування дашборду</h2>
                <p>Оберіть активні віджети</p>
                <div class="onboarding-widgets">${widgetOptions}</div>
                <button class="dashboard-btn primary" onclick="DashboardPage.saveOnboarding()" style="width:100%">Зберегти</button>
                <button class="dashboard-btn" onclick="document.getElementById('onboardingOverlay').remove()" style="width:100%;margin-top:8px">Скасувати</button>
            </div>
        `;

        document.body.appendChild(overlay);
    }

    // Test panel for creator
    function initTestPanel() {
        if (!AppState.currentUser || AppState.currentUser.role !== 'creator') return;

        // FAB button
        const fab = document.createElement('button');
        fab.className = 'test-panel-fab';
        fab.innerHTML = '🧪';
        fab.title = 'Тест-панель';
        fab.onclick = () => {
            const panel = document.getElementById('testPanel');
            if (panel) panel.classList.toggle('open');
        };
        document.body.appendChild(fab);

        // Panel
        const panel = document.createElement('div');
        panel.className = 'test-panel';
        panel.id = 'testPanel';

        const roleOptions = Object.entries(ROLE_NAMES).map(([key, name]) =>
            `<option value="${key}">${name} (${key})</option>`
        ).join('');

        const currentTestRole = localStorage.getItem('pzp_test_role');
        panel.innerHTML = `
            <h4>Тест-панель ролей</h4>
            <select id="testRoleSelect">${roleOptions}</select>
            <div class="test-panel-actions">
                <button class="btn-switch" onclick="DashboardPage.switchTestRole()">Переключити</button>
                <button class="btn-reset" onclick="DashboardPage.resetTestRole()">Скинути</button>
            </div>
        `;
        document.body.appendChild(panel);

        if (currentTestRole) {
            document.getElementById('testRoleSelect').value = currentTestRole;
            showTestModeBadge(currentTestRole);
        }
    }

    function switchTestRole() {
        const select = document.getElementById('testRoleSelect');
        if (!select) return;

        const role = select.value;
        localStorage.setItem('pzp_test_role', role);
        showTestModeBadge(role);

        // Reload to apply
        window.location.reload();
    }

    function resetTestRole() {
        localStorage.removeItem('pzp_test_role');
        const badge = document.getElementById('testModeBadge');
        if (badge) badge.remove();
        window.location.reload();
    }

    function showTestModeBadge(role) {
        let badge = document.getElementById('testModeBadge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'test-mode-badge';
            badge.id = 'testModeBadge';
            document.body.appendChild(badge);
        }
        const roleName = ROLE_NAMES[role] || role;
        badge.textContent = `Тестовий режим: ${roleName}`;
    }

    function refreshWidget(type) {
        loadWidgetData(type);
    }

    // Helpers
    function formatCurrency(amount) {
        if (amount >= 1000) return Math.round(amount / 1000) + 'k';
        return Math.round(amount) + '';
    }

    function formatDeadline(dateStr) {
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = d - now;
        const diffHours = Math.round(diffMs / 3600000);

        if (diffHours < 0) return 'Протерм.';
        if (diffHours < 1) return `${Math.round(diffMs / 60000)} хв`;
        if (diffHours < 24) return `${diffHours} год`;
        return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        init,
        refreshWidget,
        toggleOnboardingWidget,
        saveOnboarding,
        openSettings,
        switchTestRole,
        resetTestRole,
    };
})();

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    DashboardPage.init();
});
