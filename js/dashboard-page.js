/**
 * js/dashboard-page.js — Dashboard page logic (v24.3.0)
 * Widget-based personalized dashboard with customization
 */

const DashboardPage = (() => {
    // Widget definitions — all available widgets
    const WIDGET_DEFS = {
        quick_stats:    { icon: '📊', title: 'Швидка статистика', minRole: 'admin' },
        tasks:          { icon: '📋', title: 'Мої задачі', minRole: null },
        bookings_today: { icon: '📅', title: 'Бронювання сьогодні', minRole: 'admin' },
        my_schedule:    { icon: '🕐', title: 'Мій графік', minRole: null },
        team_online:    { icon: '👥', title: 'Команда онлайн', minRole: 'manager' },
        alerts:         { icon: '🔔', title: 'Сповіщення', minRole: null },
        exceptions:     { icon: '🚨', title: 'Що потребує уваги', minRole: 'admin' },
        leads_new:      { icon: '🔥', title: 'Нові ліди', minRole: 'manager' },
        finance_today:  { icon: '💰', title: 'Фінанси сьогодні', minRole: 'senior_manager' },
        weather:        { icon: '🌤', title: 'Погода', minRole: null },
        currency:       { icon: '💱', title: 'Курси валют', minRole: 'manager' },
        announcements:  { icon: '📢', title: 'Оголошення', minRole: null },
        reports_today:  { icon: '📋', title: 'Звіти сьогодні', minRole: 'senior_manager' },
        catalogs:       { icon: '📚', title: 'Авто-каталоги', minRole: 'admin' },
        account_stats:  { icon: '🔗', title: 'Акаунти CRM', minRole: 'manager' },
        staff_today:    { icon: '👷', title: 'Хто на зміні', minRole: 'manager' },
        week_bookings:  { icon: '📆', title: 'Бронювання на тиждень', minRole: 'admin' },
        team_tasks:     { icon: '📝', title: 'Задачі команди', minRole: 'manager' },
        hr_overview:    { icon: '🏥', title: 'HR дайджест', minRole: 'hr' },
        director_pnl:   { icon: '💹', title: 'P&L', minRole: 'director' },
        content_pipeline: { icon: '🎨', title: 'Контент-пайплайн', minRole: 'art_director' },
        operations:     { icon: '⚙️', title: 'Операції', minRole: 'vice_director' },
    };

    let _config = { widgets: [], layout: {}, theme: 'default' };
    let _widgetData = {};
    let _workQueueReplyScope = normalizeWorkQueueReplyScope(localStorage.getItem('eg_reply_backlog_scope'));

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
                if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
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

        // Decision Screen — before dashboard loads
        if (typeof DecisionScreen !== 'undefined') {
            try { await DecisionScreen.init(); } catch(e) { console.error('[Dashboard] DecisionScreen.init failed:', e); }
        }

        // Load config
        await loadConfig();

        // Init test panel for creator
        initTestPanel();

        // Render greeting
        renderGreeting();
        loadWorkQueue();
    }

    async function loadConfig() {
        try {
            const resp = await fetch('/api/dashboard/config', {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
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

    async function loadWorkQueue() {
        const panel = document.getElementById('workQueuePanel');
        const body = document.getElementById('workQueueBody');
        if (!panel || !body) return;

        if (typeof hasMinRole === 'function' && !hasMinRole('manager')) {
            panel.hidden = true;
            return;
        }

        panel.hidden = false;
        body.innerHTML = '<div class="widget-loading">Завантаження черги...</div>';
        renderWorkQueueScopeControls();

        try {
            const params = new URLSearchParams({ replyScope: _workQueueReplyScope });
            const resp = await fetch(`/api/work-queue?${params.toString()}`, {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
            });
            if (resp.status === 403 || resp.status === 401) {
                panel.hidden = true;
                return;
            }
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            renderWorkQueue(data.queue || {}, body);
        } catch (err) {
            console.error('Work queue load error:', err);
            if (window.Explainability) Explainability.setRegion('workQueueExplainability', '');
            body.innerHTML = '<div class="widget-empty">Не вдалося завантажити робочу чергу</div>';
        }
    }

    function normalizeWorkQueueReplyScope(value) {
        return ['mine', 'team', 'all'].includes(value) ? value : 'all';
    }

    function workQueueReplyScopeLabel(scope) {
        switch (scope) {
            case 'mine': return 'Мої';
            case 'team': return 'Команда';
            default: return 'Усі';
        }
    }

    function renderWorkQueueScopeControls(meta = {}) {
        const target = document.getElementById('workQueueScopeControls');
        if (!target) return;
        const active = normalizeWorkQueueReplyScope(meta.replyBacklog?.scope || _workQueueReplyScope);
        const scopes = ['mine', 'team', 'all'];
        target.innerHTML = scopes.map(scope => `
            <button type="button"
                class="work-queue-scope-btn${scope === active ? ' active' : ''}"
                aria-pressed="${scope === active ? 'true' : 'false'}"
                onclick="DashboardPage.setWorkQueueReplyScope('${scope}')">
                ${escapeHtml(workQueueReplyScopeLabel(scope))}
            </button>
        `).join('');
    }

    function renderWorkQueue(queue, container) {
        const buckets = Array.isArray(queue.buckets) ? queue.buckets : [];
        const visibleBuckets = buckets.filter(bucket => bucket.count > 0 || (bucket.items && bucket.items.length > 0));
        const subtitle = document.getElementById('workQueueSubtitle');
        if (subtitle && queue.date) {
            subtitle.textContent = `Сьогодні ${formatQueueDate(queue.date.today)} · сформовано ${formatQueueDateTime(queue.generatedAt)}`;
        }
        renderWorkQueueScopeControls(queue.meta || {});
        renderWorkQueueExplainability(queue, buckets, visibleBuckets.length);

        if (!visibleBuckets.length) {
            container.innerHTML = '<div class="widget-empty">Немає термінових пунктів у доступних buckets черги. Waiting reply зʼявиться лише для розмов із явним reply expectation.</div>';
            return;
        }

        container.innerHTML = visibleBuckets.map(bucket => {
            const items = (bucket.items || []).slice(0, 4).map(renderWorkQueueItem).join('');
            return `
                <div class="work-queue-bucket bucket-${bucket.key}">
                    <div class="work-queue-bucket-head">
                        <span class="work-queue-bucket-title">${escapeHtml(bucket.label || bucket.key)}</span>
                        <span class="work-queue-count">${bucket.count || 0}</span>
                    </div>
                    <div class="work-queue-items">${items}</div>
                </div>
            `;
        }).join('');
    }

    function renderWorkQueueExplainability(queue, buckets, visibleCount) {
        const target = document.getElementById('workQueueExplainability');
        if (!target || !window.Explainability) return;
        const meta = queue.meta || {};
        const bucketMap = new Map((buckets || []).map(bucket => [bucket.key, bucket.label || bucket.key]));
        const warnings = Array.isArray(meta.warnings) ? meta.warnings : [];
        const omitted = Array.isArray(meta.omittedBuckets) ? meta.omittedBuckets : [];
        const heuristic = Array.isArray(meta.heuristicBuckets) ? meta.heuristicBuckets : [];
        const filters = [];
        const replyBacklog = meta.replyBacklog || {};

        if (warnings.length) filters.push({ label: 'Увага', value: `${warnings.length} джерел не відповіли` });
        if (replyBacklog.scope) filters.push({ label: 'Reply backlog', value: workQueueReplyScopeLabel(replyBacklog.scope) });
        if (omitted.length) filters.push({ label: 'Не включено', value: omitted.map(key => bucketMap.get(key) || key).join(', ') });
        const activeHeuristic = heuristic.filter(key => (buckets || []).some(bucket => bucket.key === key && bucket.count > 0));
        if (activeHeuristic.length) {
            filters.push({ label: 'Підказки', value: activeHeuristic.map(key => bucketMap.get(key) || key).join(', ') });
        }

        const note = !visibleCount ? 'Порожньо: доступні durable сигнали зараз не дали термінових пунктів' : '';
        const html = Explainability.renderFilterSummary(filters, {
            label: 'Пояснення черги',
            note
        });
        Explainability.setRegion(target, html);
    }

    function replySlaLabel(state) {
        switch (state) {
            case 'overdue': return 'SLA прострочено';
            case 'due_soon': return 'SLA скоро спливає';
            case 'on_track': return 'SLA в нормі';
            default: return '';
        }
    }

    function renderWorkQueueItem(item) {
        const priorityCls = item.priority ? ` priority-${item.priority}` : '';
        const bucketCls = item.bucket ? ` bucket-${item.bucket}` : '';
        const waitingCls = item.bucket === 'waiting_reply' ? ' is-waiting-reply' : '';
        const confidence = item.confidence === 'suggested' ? '<span class="work-queue-confidence">підказка</span>' : '';
        const due = item.dueAt ? `<span>${formatQueueDateTime(item.dueAt)}</span>` : '';
        const waitingSince = item.bucket === 'waiting_reply' && item.meta?.awaitingReplySince
            ? `<span class="work-queue-state-pill">очікуємо з ${formatQueueDateTime(item.meta.awaitingReplySince)}</span>`
            : '';
        const owner = item.bucket === 'waiting_reply' && item.meta?.assignedTo
            ? `<span>${escapeHtml(item.meta.assignedTo)}</span>`
            : '';
        const slaLabel = item.bucket === 'waiting_reply' ? replySlaLabel(item.meta?.replySlaState) : '';
        const slaState = item.meta?.replySlaState || 'none';
        const sla = slaLabel
            ? `<span class="work-queue-sla-pill sla-${escapeHtml(slaState)}">${escapeHtml(slaLabel)}</span>`
            : '';
        const meta = [waitingSince || due, sla, owner, confidence].filter(Boolean).join(' · ');
        const href = item.href || '/dashboard';
        return `
            <a class="work-queue-item${priorityCls}${bucketCls}${waitingCls}" href="${escapeHtml(href)}">
                <span class="work-queue-dot" aria-hidden="true"></span>
                <span class="work-queue-text">
                    <span class="work-queue-title">${escapeHtml(item.title || item.actionLabel || 'Пункт черги')}</span>
                    <span class="work-queue-meta">${meta}${item.subtitle ? ' · ' + escapeHtml(String(item.subtitle).slice(0, 90)) : ''}</span>
                </span>
                <span class="work-queue-action">${escapeHtml(item.actionLabel || 'Відкрити')}</span>
            </a>
        `;
    }

    function formatQueueDate(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });
    }

    function formatQueueDateTime(value) {
        if (!value) return '—';
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return formatQueueDate(value);
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace('T', ' ');
        return date.toLocaleString('uk-UA', {
            timeZone: 'Europe/Kyiv',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
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
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const result = await resp.json();

            if (result.success) {
                _widgetData[type] = result.data;
                renderWidgetContent(type, result.data, container);
            } else {
                container.innerHTML = '<div class="widget-empty">Помилка завантаження</div>';
            }
        } catch (err) {
            console.error(`Widget ${type} load error:`, err);
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
            case 'alerts':
                renderAlerts(data, container);
                break;
            case 'exceptions':
                renderExceptions(data, container);
                break;
            case 'leads_new':
                renderLeadsNew(data, container);
                break;
            case 'finance_today':
                renderFinanceToday(data, container);
                break;
            case 'reports_today':
                renderReportsToday(data, container);
                break;
            case 'catalogs':
                renderCatalogs(data, container);
                break;
            case 'account_stats':
                renderAccountStats(data, container);
                break;
            case 'staff_today':
                renderStaffToday(data, container);
                break;
            case 'week_bookings':
                renderWeekBookings(data, container);
                break;
            case 'team_tasks':
                renderTeamTasks(data, container);
                break;
            case 'hr_overview':
                renderHrOverview(data, container);
                break;
            case 'director_pnl':
                renderDirectorPnl(data, container);
                break;
            case 'content_pipeline':
                renderContentPipeline(data, container);
                break;
            case 'operations':
                renderOperations(data, container);
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
            const catInfo = { event: '🎉', purchase: '🛒', admin: '📎', trampoline: '🤸', personal: '👤', improvement: '⚡' };
            const catIcon = catInfo[t.category] || '📋';
            const statusLabel = t.status === 'in_progress' ? 'В роботі' : t.status === 'todo' ? 'Todo' : t.status;
            return `<div class="widget-task-item" onclick="DashboardPage.openTask(${t.id})" title="Відкрити задачу">
                <div class="widget-task-icon ${priorityCls}"></div>
                <div class="widget-task-info">
                    <div class="widget-task-title">${escapeHtml(t.title)}</div>
                    <div class="widget-task-meta">${catIcon} ${statusLabel}${deadline ? ' · ' + deadline : ''}</div>
                </div>
                <div class="widget-task-arrow">›</div>
            </div>`;
        }).join('');

        const footer = `<div class="widget-footer"><a href="/tasks" class="widget-footer-link">Всі задачі →</a></div>`;
        container.innerHTML = `<div class="widget-task-list">${items}</div>${footer}`;
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

        const statusMap = { working: 'На зміні', dayoff: 'Вихідний', day_off: 'Вихідний', vacation: 'Відпустка', sick: 'Лікарняний', remote: 'Віддалено' };
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
            const profileLink = m.username ? ` onclick="openStaffProfile('${m.username}')" style="cursor:pointer" title="Профіль: ${m.username}"` : '';
            return `<div class="team-member"${profileLink}>
                <div class="team-avatar">${initial}</div>
                ${escapeHtml(m.name)}
                ${m.username ? '<span class="staff-crm-badge has-account" style="margin-left:2px;padding:0 4px;font-size:9px">👤</span>' : ''}
                <div class="team-online-dot"></div>
            </div>`;
        }).join('');

        container.innerHTML = `<div class="team-grid">${items}</div>`;
    }

    function renderWeather(data, container) {
        if (data.error) {
            container.innerHTML = `<div class="widget-empty">${escapeHtml(data.error)}</div>`;
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
            container.innerHTML = `<div class="widget-empty">${escapeHtml(data.error)}</div>`;
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

    function renderAlerts(data, container) {
        if (!data.alerts || data.alerts.length === 0) {
            container.innerHTML = '<div class="widget-empty">✅ Все в порядку</div>';
            return;
        }
        const DEFAULT_LINKS = { warning: '/tasks', info: '/', critical: '/finance' };
        const items = data.alerts.map(a => {
            const typeCls = a.level === 'critical' ? 'alert-critical' : a.level === 'warning' ? 'alert-warning' : 'alert-info';
            const link = a.link || DEFAULT_LINKS[a.level] || '/dashboard';
            return `<a href="${link}" class="dash-alert-item ${typeCls}" title="Перейти →">
                <span class="dash-alert-icon">${a.icon || '🔔'}</span>
                <span class="dash-alert-text">${escapeHtml(a.title)}</span>
                <span class="dash-alert-arrow">›</span>
            </a>`;
        }).join('');
        container.innerHTML = items;
    }

    function renderExceptions(data, container) {
        if (!data.exceptions || data.exceptions.length === 0) {
            container.innerHTML = '<div class="widget-empty">✅ Все під контролем — жодних виключень</div>';
            return;
        }
        const catLabels = {
            conflicts: '💥 Конфлікти', noAnimator: '🎭 Без аніматора',
            overduePrep: '⏰ Підготовка', detractors: '😞 NPS',
            cleaningSLA: '🧹 Прибирання', unconfirmedLate: '🔴 Не підтверджено'
        };
        // Category summary bar
        const cats = data.categories || {};
        const summaryParts = Object.entries(cats)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `<span class="exc-cat-badge" title="${catLabels[k] || k}">${(catLabels[k] || k).split(' ')[0]} ${v}</span>`)
            .join('');
        const summary = summaryParts ? `<div class="exc-summary">${summaryParts}</div>` : '';

        const items = data.exceptions.slice(0, 8).map(e => {
            const lvlCls = e.level === 'critical' ? 'alert-critical' : e.level === 'warning' ? 'alert-warning' : 'alert-info';
            const link = e.link || '/';
            return `<a href="${link}" class="dash-alert-item ${lvlCls}" title="${escapeHtml(e.action?.prompt || '')}">
                <span class="dash-alert-icon">${e.icon || '⚠️'}</span>
                <span class="dash-alert-text">${escapeHtml(e.title)}</span>
                <span class="dash-alert-arrow">›</span>
            </a>`;
        }).join('');
        container.innerHTML = summary + items;
    }

    function renderLeadsNew(data, container) {
        if (!data.leads || data.leads.length === 0) {
            container.innerHTML = '<div class="widget-empty">Немає нових лідів</div>';
            return;
        }
        const sourceColors = { telegram: '#0088cc', facebook: '#1877F2', instagram: '#E4405F', viber: '#7360F2', website: '#38A169', phone: '#DD6B20' };
        const items = data.leads.slice(0, 6).map(l => {
            const color = sourceColors[l.source] || '#718096';
            const date = new Date(l.created_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            return `<div class="widget-lead-item">
                <div class="lead-source-dot" style="background:${color}" title="${escapeHtml(l.source || '')}"></div>
                <div class="lead-info">
                    <div class="lead-name">${escapeHtml(l.name || 'Без імені')}</div>
                    <div class="lead-meta">${escapeHtml(l.phone || '')} · ${date}</div>
                </div>
            </div>`;
        }).join('');
        container.innerHTML = `<div class="widget-lead-list">${items}</div>`;
    }

    function renderFinanceToday(data, container) {
        const fmt = (v) => {
            if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return Math.round(v) + '';
        };
        container.innerHTML = `
            <div class="finance-today-grid">
                <div class="finance-stat revenue">
                    <div class="finance-stat-value">${fmt(data.revenue || 0)} ₴</div>
                    <div class="finance-stat-label">Виручка</div>
                </div>
                <div class="finance-stat expenses">
                    <div class="finance-stat-value">${fmt(data.expenses || 0)} ₴</div>
                    <div class="finance-stat-label">Витрати</div>
                </div>
                <div class="finance-stat profit">
                    <div class="finance-stat-value ${(data.profit || 0) >= 0 ? 'positive' : 'negative'}">${(data.profit || 0) >= 0 ? '+' : ''}${fmt(data.profit || 0)} ₴</div>
                    <div class="finance-stat-label">Прибуток</div>
                </div>
                <div class="finance-stat bookings">
                    <div class="finance-stat-value">${data.bookings || 0}</div>
                    <div class="finance-stat-label">Бронювань</div>
                </div>
            </div>
        `;
    }

    function renderReportsToday(data, container) {
        const fmt = (v) => {
            if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return Math.round(v) + '';
        };
        container.innerHTML = `
            <div class="finance-today-grid">
                <div class="finance-stat revenue">
                    <div class="finance-stat-value">${fmt(data.income || 0)} ₴</div>
                    <div class="finance-stat-label">Доходи</div>
                </div>
                <div class="finance-stat expenses">
                    <div class="finance-stat-value">${fmt(data.expense || 0)} ₴</div>
                    <div class="finance-stat-label">Витрати</div>
                </div>
                <div class="finance-stat bookings">
                    <div class="finance-stat-value">${data.newCount || 0}</div>
                    <div class="finance-stat-label">Нових звітів</div>
                </div>
            </div>
            <a href="/reports" style="display:block;text-align:center;margin-top:8px;font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">
                Відкрити звіти →
            </a>
        `;
    }

    function renderCatalogs(data, container) {
        const items = data.recentItems || [];
        const defs = data.definitions || [];
        let html = '';
        if (defs.length) {
            html += '<div class="catalog-defs-row">';
            defs.forEach(d => {
                html += `<span class="catalog-def-badge" title="${escapeHtml(d.name)}">${d.emoji} ${escapeHtml(d.name)} <small>(${d.count || 0})</small></span> `;
            });
            html += '</div>';
        }
        if (items.length) {
            html += '<div class="catalog-mini-list">';
            items.forEach(it => {
                html += `<div class="catalog-mini-item">
                    <div class="catalog-mini-thumb">${it.image_url ? '<img src="' + escapeHtml(it.image_url) + '" loading="lazy" alt="">' : '<span>' + (it.catalog_emoji || '🗂️') + '</span>'}</div>
                    <div class="catalog-mini-info">
                        <span class="catalog-mini-name">${escapeHtml(it.name)}</span>
                        <span class="catalog-mini-meta">${escapeHtml(it.catalog_name || '')}${it.price ? ' · ' + it.price + ' грн' : ''}</span>
                    </div>
                </div>`;
            });
            html += '</div>';
        } else {
            html += '<div class="widget-empty">Позицій ще немає</div>';
        }
        html += `<div style="display:flex;gap:8px;margin-top:8px;justify-content:center">
            <button class="btn-primary btn-sm" onclick="openAddCatalogItem()">+ Додати позицію</button>
            <a href="/designs" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none;line-height:32px">Каталоги →</a>
        </div>`;
        container.innerHTML = html;
    }

    function renderAccountStats(data, container) {
        const total = parseInt(data.total_staff) || 0;
        const linked = parseInt(data.with_account) || 0;
        const unlinked = parseInt(data.without_account) || 0;
        const freelance = parseInt(data.freelance_slots) || 0;
        const pct = total > 0 ? Math.round(linked / total * 100) : 0;
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value" style="color:#22c55e">${linked}</div>
                    <div class="stat-label">З акаунтом</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value" style="color:#f59e0b">${unlinked}</div>
                    <div class="stat-label">Без акаунту</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value" style="color:var(--gray-400)">${freelance}</div>
                    <div class="stat-label">Фріланс</div>
                </div>
            </div>
            <div style="margin-top:8px;text-align:center">
                <div style="background:var(--gray-200);border-radius:8px;height:6px;overflow:hidden;margin-bottom:6px">
                    <div style="background:#22c55e;height:100%;width:${pct}%;border-radius:8px;transition:width 0.3s"></div>
                </div>
                <span style="font-size:11px;color:var(--gray-500)">${pct}% зв'язано</span>
            </div>
            <div style="text-align:center;margin-top:8px">
                <a href="/staff" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Переглянути →</a>
            </div>
        `;
    }

    // v39.10: Staff on shift today
    function renderStaffToday(data, container) {
        if (!data.onShift?.length && !data.absent?.length) {
            container.innerHTML = '<div class="widget-empty">Немає даних про зміни</div>';
            return;
        }
        const deptGroups = {};
        (data.onShift || []).forEach(s => {
            const dept = s.department || 'інше';
            if (!deptGroups[dept]) deptGroups[dept] = [];
            deptGroups[dept].push(s);
        });
        const DEPT_LABELS = { animators: '🎭 Аніматори', admin: '📋 Адмін', cafe: '☕ Кафе', cleaning: '🧹 Господарчі', security: '🔒 Охорона', trampoline: '🤸 Батути' };
        let html = `<div style="font-size:12px;color:var(--gray-500);margin-bottom:8px">На зміні: <b>${data.onShift?.length || 0}</b></div>`;
        for (const [dept, staff] of Object.entries(deptGroups)) {
            html += `<div style="font-size:11px;font-weight:700;color:var(--gray-400);margin:6px 0 2px">${DEPT_LABELS[dept] || dept}</div>`;
            staff.forEach(s => {
                const initials = (s.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2);
                html += `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px">
                    <div style="width:24px;height:24px;border-radius:50%;background:${s.color || '#6366f1'}30;color:${s.color || '#6366f1'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${initials}</div>
                    <span style="flex:1;${s.is_online ? 'font-weight:600' : ''}">${escapeHtml(s.name)}</span>
                    <span style="color:var(--gray-400);font-size:11px">${s.shift_start || ''}–${s.shift_end || ''}</span>
                    ${s.is_online ? '<span style="width:6px;height:6px;border-radius:50%;background:#22c55e;flex-shrink:0" title="Онлайн"></span>' : ''}
                </div>`;
            });
        }
        if (data.absent?.length) {
            html += `<div style="font-size:11px;font-weight:700;color:#ef4444;margin:8px 0 2px">🏥 Відсутні (${data.absent.length})</div>`;
            data.absent.forEach(s => {
                const labels = { sick: '🏥 Лікарняний', vacation: '🌴 Відпустка' };
                html += `<div style="font-size:12px;color:var(--gray-500);padding:2px 0">${escapeHtml(s.name)} — ${labels[s.status] || s.status}</div>`;
            });
        }
        html += `<div style="text-align:center;margin-top:8px"><a href="/staff" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Графік →</a></div>`;
        container.innerHTML = html;
    }

    // v39.10: Week bookings
    function renderWeekBookings(data, container) {
        if (!data.days?.length) {
            container.innerHTML = '<div class="widget-empty">Немає бронювань на тиждень</div>';
            return;
        }
        const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const totalRev = data.days.reduce((s, d) => s + (d.revenue || 0), 0);
        const totalCount = data.days.reduce((s, d) => s + (d.count || 0), 0);
        let html = `<div class="stats-grid" style="margin-bottom:8px">
            <div class="stat-item"><div class="stat-value">${totalCount}</div><div class="stat-label">Бронювань</div></div>
            <div class="stat-item"><div class="stat-value">${formatCurrency(totalRev)}</div><div class="stat-label">Виручка</div></div>
        </div>`;
        html += '<div style="display:flex;gap:4px;align-items:flex-end;height:80px;margin-top:8px">';
        const maxCount = Math.max(...data.days.map(d => d.count || 0), 1);
        data.days.forEach(d => {
            const dt = new Date(d.date + 'T12:00:00');
            const dayName = dayNames[dt.getDay()];
            const dayNum = dt.getDate();
            const h = Math.max(8, Math.round(((d.count || 0) / maxCount) * 60));
            const isToday = d.date === data.from;
            html += `<div style="flex:1;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:flex-end">
                <div style="font-size:10px;font-weight:700;color:var(--gray-500);margin-bottom:2px">${d.count || 0}</div>
                <div style="width:100%;max-width:28px;height:${h}px;border-radius:4px 4px 0 0;background:${isToday ? 'linear-gradient(135deg,var(--primary),var(--primary-dark))' : d.pending > 0 ? '#f59e0b' : 'var(--gray-200)'};transition:height 0.3s" title="${d.confirmed || 0} підтв. / ${d.pending || 0} очік."></div>
                <div style="font-size:10px;color:${isToday ? 'var(--primary)' : 'var(--gray-400)'};font-weight:${isToday ? '800' : '400'};margin-top:2px">${dayName}<br>${dayNum}</div>
            </div>`;
        });
        html += '</div>';
        html += `<div style="text-align:center;margin-top:8px"><a href="/" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Таймлайн →</a></div>`;
        container.innerHTML = html;
    }

    // v39.10: Team tasks
    function renderTeamTasks(data, container) {
        const s = data.stats || {};
        let html = `<div class="stats-grid" style="margin-bottom:8px">
            <div class="stat-item"><div class="stat-value" style="color:#f59e0b">${s.todo || 0}</div><div class="stat-label">Очікують</div></div>
            <div class="stat-item"><div class="stat-value" style="color:var(--primary)">${s.in_progress || 0}</div><div class="stat-label">В роботі</div></div>
            <div class="stat-item"><div class="stat-value" style="color:#ef4444">${s.overdue || 0}</div><div class="stat-label">Прострочено</div></div>
        </div>`;
        if (data.tasks?.length) {
            html += '<div style="max-height:200px;overflow-y:auto">';
            data.tasks.slice(0, 10).forEach(t => {
                const overdue = t.is_overdue ? ' style="border-left:3px solid #ef4444"' : '';
                const pIcon = t.priority === 'high' ? '🔴 ' : '';
                html += `<div style="padding:6px 8px;border-radius:6px;margin-bottom:4px;background:var(--gray-50,rgba(0,0,0,0.02));font-size:12px;cursor:pointer"${overdue} onclick="window.location='/tasks?open=${t.id}'">
                    <div style="font-weight:600">${pIcon}${escapeHtml(t.title?.slice(0, 50) || '')}</div>
                    <div style="color:var(--gray-400);font-size:11px;margin-top:2px">
                        ${t.assigned_to ? '👤 ' + escapeHtml(t.assigned_to) : '— нікому'}
                        ${t.deadline ? ' · ⏰ ' + new Date(t.deadline).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) : ''}
                    </div>
                </div>`;
            });
            html += '</div>';
        }
        html += `<div style="text-align:center;margin-top:8px"><a href="/tasks" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Всі задачі →</a></div>`;
        container.innerHTML = html;
    }

    // v39.10: HR overview
    function renderHrOverview(data, container) {
        let html = '';
        if (data.absent?.length) {
            html += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:#ef4444;margin-bottom:4px">🏥 Відсутні сьогодні (${data.absent.length})</div>`;
            data.absent.forEach(s => {
                const label = s.status === 'sick' ? '🏥' : '🌴';
                html += `<div style="font-size:12px;padding:2px 0">${label} ${escapeHtml(s.name)}</div>`;
            });
            html += '</div>';
        }
        if (data.pendingLeaves?.length) {
            html += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:4px">📋 Заявки на затвердження (${data.pendingLeaves.length})</div>`;
            data.pendingLeaves.forEach(l => {
                html += `<div style="font-size:12px;padding:2px 0">${escapeHtml(l.name)} — ${l.type} (${l.date_from?.slice(5)} → ${l.date_to?.slice(5)})</div>`;
            });
            html += '</div>';
        }
        if (data.birthdays?.length) {
            html += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--primary);margin-bottom:4px">🎂 Дні народження цього тижня</div>`;
            data.birthdays.forEach(b => {
                const day = b.birth_date ? new Date(b.birth_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }) : '';
                html += `<div style="font-size:12px;padding:2px 0">🎂 ${escapeHtml(b.name)} ${day}</div>`;
            });
            html += '</div>';
        }
        if (!html) html = '<div class="widget-empty">Все спокійно в HR</div>';
        html += `<div style="text-align:center;margin-top:8px"><a href="/hr" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">HR →</a></div>`;
        container.innerHTML = html;
    }

    // v39.10: Director P&L
    function renderDirectorPnl(data, container) {
        const w = data.week || {};
        const m = data.month || {};
        container.innerHTML = `
            <div style="font-size:11px;font-weight:700;color:var(--gray-400);margin-bottom:4px">📊 Цей тиждень</div>
            <div class="stats-grid" style="margin-bottom:12px">
                <div class="stat-item"><div class="stat-value" style="color:#22c55e">${formatCurrency(w.revenue || 0)}</div><div class="stat-label">Дохід</div></div>
                <div class="stat-item"><div class="stat-value" style="color:#ef4444">${formatCurrency(w.expenses || 0)}</div><div class="stat-label">Витрати</div></div>
                <div class="stat-item"><div class="stat-value" style="color:${(w.profit||0)>=0?'#22c55e':'#ef4444'}">${formatCurrency(w.profit || 0)}</div><div class="stat-label">Прибуток</div></div>
            </div>
            <div style="font-size:11px;font-weight:700;color:var(--gray-400);margin-bottom:4px">📅 Цей місяць</div>
            <div class="stats-grid" style="margin-bottom:8px">
                <div class="stat-item"><div class="stat-value" style="color:#22c55e">${formatCurrency(m.revenue || 0)}</div><div class="stat-label">Дохід</div></div>
                <div class="stat-item"><div class="stat-value" style="color:#ef4444">${formatCurrency(m.expenses || 0)}</div><div class="stat-label">Витрати</div></div>
                <div class="stat-item"><div class="stat-value" style="color:${(m.profit||0)>=0?'#22c55e':'#ef4444'}">${formatCurrency(m.profit || 0)}</div><div class="stat-label">Прибуток</div></div>
            </div>
            <div style="font-size:11px;color:var(--gray-500)">👥 ${data.staffCount || 0} співробітників</div>
            <div style="text-align:center;margin-top:8px"><a href="/finance" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Фінанси →</a></div>
        `;
    }

    // v39.10: Art director content pipeline
    function renderContentPipeline(data, container) {
        let html = '';
        if (data.inReview?.length) {
            html += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:4px">👁 На ревью (${data.inReview.length})</div>`;
            data.inReview.forEach(c => {
                html += `<div style="font-size:12px;padding:3px 0;cursor:pointer" onclick="window.location='/art-director'">${escapeHtml(c.title?.slice(0, 40) || 'Без назви')}</div>`;
            });
            html += '</div>';
        }
        html += `<div style="font-size:12px;color:var(--gray-500);margin-bottom:8px">✅ Затверджено за тиждень: <b>${data.approvedThisWeek || 0}</b></div>`;
        if (data.designTasks?.length) {
            html += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--primary);margin-bottom:4px">🎨 Дизайн-задачі</div>`;
            data.designTasks.forEach(t => {
                const pIcon = t.priority === 'high' ? '🔴 ' : '';
                html += `<div style="font-size:12px;padding:2px 0">${pIcon}${escapeHtml(t.title?.slice(0, 45) || '')}</div>`;
            });
            html += '</div>';
        }
        if (data.catalogs?.length) {
            html += `<div style="font-size:11px;font-weight:700;color:var(--gray-400);margin-bottom:4px">📚 Каталоги (${data.catalogs.length})</div>`;
            html += data.catalogs.map(c => `<span style="font-size:12px;margin-right:8px">${c.emoji || '📂'} ${escapeHtml(c.name)} <span style="color:${c.status==='ready'?'#22c55e':'#f59e0b'};font-size:10px">${c.status==='ready'?'✅':'🔄'}</span></span>`).join('');
        }
        html += `<div style="text-align:center;margin-top:8px"><a href="/designs" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Дизайн →</a></div>`;
        container.innerHTML = html || '<div class="widget-empty">Контент пайплайн порожній</div>';
    }

    // v39.10: Vice director operations
    function renderOperations(data, container) {
        const q = data.quality || {};
        let html = `<div class="stats-grid" style="margin-bottom:8px">
            <div class="stat-item"><div class="stat-value">${q.avg_rating || '—'}</div><div class="stat-label">Рейтинг (30д)</div></div>
            <div class="stat-item"><div class="stat-value" style="color:#ef4444">${data.complaintsWeek || 0}</div><div class="stat-label">Скарги (7д)</div></div>
            <div class="stat-item"><div class="stat-value" style="color:#f59e0b">${data.staffNotCheckedIn || 0}</div><div class="stat-label">Не на місці</div></div>
        </div>`;
        if (data.procurement?.length) {
            html += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--gray-400);margin-bottom:4px">🛒 Закупки (${data.procurement.length})</div>`;
            data.procurement.forEach(p => {
                const statusLabel = p.status === 'ordered' ? '📦 Замовлено' : '📝 Чернетка';
                html += `<div style="font-size:12px;padding:2px 0">${statusLabel} ${escapeHtml(p.name?.slice(0, 40) || '')}</div>`;
            });
            html += '</div>';
        }
        html += `<div style="text-align:center;margin-top:8px"><a href="/center" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Центр →</a></div>`;
        container.innerHTML = html;
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

    // Settings modal with drag & drop reordering
    function openSettings() {
        const availableWidgets = Object.entries(WIDGET_DEFS)
            .filter(([, def]) => !def.minRole || (typeof hasMinRole === 'function' && hasMinRole(def.minRole)));

        const activeWidgets = _config ? (_config.widgets || []) : [];

        // Sort: active first (in order), then inactive
        const sortedWidgets = [
            ...activeWidgets.filter(k => availableWidgets.some(([wk]) => wk === k)).map(k => [k, WIDGET_DEFS[k]]),
            ...availableWidgets.filter(([k]) => !activeWidgets.includes(k)),
        ];

        const widgetItems = sortedWidgets.map(([key, def]) => {
            const isActive = activeWidgets.includes(key);
            return `<div class="settings-widget-item ${isActive ? 'active' : ''}" data-widget="${key}" draggable="true">
                <span class="settings-drag-handle">⠿</span>
                <span class="settings-widget-icon">${def.icon}</span>
                <span class="settings-widget-name">${def.title}</span>
                <label class="settings-toggle">
                    <input type="checkbox" ${isActive ? 'checked' : ''} onchange="DashboardPage.toggleSettingsWidget(this)">
                    <span class="settings-toggle-slider"></span>
                </label>
            </div>`;
        }).join('');

        // Remove previous settings modal if open
        const prev = document.getElementById('settingsOverlay');
        if (prev) prev.remove();

        const overlay = document.createElement('div');
        overlay.className = 'onboarding-overlay';
        overlay.id = 'settingsOverlay';
        overlay.innerHTML = `
            <div class="settings-modal">
                <div class="settings-modal-header">
                    <h2>Налаштування дашборду</h2>
                    <p>Увімкніть віджети та перетягніть для зміни порядку</p>
                </div>
                <div class="settings-widget-list" id="settingsWidgetList">${widgetItems}</div>
                <div class="settings-modal-footer">
                    <button class="dashboard-btn" onclick="document.getElementById('settingsOverlay')?.remove()">Скасувати</button>
                    <button class="dashboard-btn primary" onclick="DashboardPage.saveSettings()">Зберегти</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        _initDragAndDrop();
    }

    function toggleSettingsWidget(checkbox) {
        const item = checkbox.closest('.settings-widget-item');
        if (checkbox.checked) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    }

    function _initDragAndDrop() {
        const list = document.getElementById('settingsWidgetList');
        if (!list) return;

        let dragEl = null;

        list.addEventListener('dragstart', (e) => {
            dragEl = e.target.closest('.settings-widget-item');
            if (!dragEl) return;
            dragEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        list.addEventListener('dragend', () => {
            if (dragEl) dragEl.classList.remove('dragging');
            dragEl = null;
            list.querySelectorAll('.settings-widget-item').forEach(el => el.classList.remove('drag-over'));
        });

        list.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const target = e.target.closest('.settings-widget-item');
            if (!target || target === dragEl) return;

            list.querySelectorAll('.settings-widget-item').forEach(el => el.classList.remove('drag-over'));
            target.classList.add('drag-over');

            const rect = target.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                list.insertBefore(dragEl, target);
            } else {
                list.insertBefore(dragEl, target.nextSibling);
            }
        });

        list.addEventListener('drop', (e) => {
            e.preventDefault();
        });
    }

    async function saveSettings() {
        const list = document.getElementById('settingsWidgetList');
        if (!list) return;

        const selected = [];
        list.querySelectorAll('.settings-widget-item').forEach(el => {
            const cb = el.querySelector('input[type="checkbox"]');
            if (cb && cb.checked) {
                selected.push(el.dataset.widget);
            }
        });

        if (selected.length === 0) {
            selected.push('tasks', 'weather');
        }

        if (!_config) _config = { widgets: [], layout: {}, theme: 'default' };
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
        } catch (err) {
            console.error('Save settings error:', err);
        }

        const overlay = document.getElementById('settingsOverlay');
        if (overlay) overlay.remove();

        renderWidgets();
    }

    // Test panel for creator
    function initTestPanel() {
        // v33.8.0: Dev Tools hidden temporarily
        return;

        if (!AppState.currentUser || AppState.currentUser.role !== 'creator') return;

        // v24.0.0: Dev Tools section on dashboard (replaces old FAB test panel)
        const grid = document.getElementById('dashboardGrid');
        if (!grid) return;

        const devTools = document.createElement('div');
        devTools.className = 'widget-card widget-devtools';
        devTools.dataset.widget = 'devtools';

        const roleOptions = Object.entries(ROLE_NAMES).map(([key, name]) =>
            `<option value="${key}">${name} (${key})</option>`
        ).join('');

        const currentTestRole = localStorage.getItem('pzp_test_role') || sessionStorage.getItem('testRole');
        const imp = sessionStorage.getItem('impersonating');
        let statusHtml = '';
        if (imp) {
            statusHtml = `<div class="devtools-badge imp">👤 Імперсонація: ${imp} <button class="devtools-badge-close" id="devtoolsResetImp">&times;</button></div>`;
        } else if (currentTestRole) {
            statusHtml = `<div class="devtools-badge role">🎭 Тест: ${ROLE_NAMES[currentTestRole] || currentTestRole} <button class="devtools-badge-close" id="devtoolsResetRole">&times;</button></div>`;
        }

        devTools.innerHTML = `
            <div class="widget-header">
                <div class="widget-title">
                    <span class="widget-title-icon">🎭</span>
                    Dev Tools (тільки для Creator)
                </div>
            </div>
            <div class="widget-body" id="widget-devtools">
                <div class="devtools-grid">
                    <div class="devtools-section">
                        <label class="devtools-label">Симулювати роль:</label>
                        <div class="devtools-row">
                            <select id="testRoleSelect" class="devtools-select">${roleOptions}</select>
                            <button class="devtools-btn" onclick="DashboardPage.switchTestRole()">▶</button>
                            <button class="devtools-btn secondary" onclick="DashboardPage.resetTestRole()">✕</button>
                        </div>
                    </div>
                    <div class="devtools-section">
                        <label class="devtools-label">Симулювати юзера:</label>
                        <div class="devtools-row">
                            <select id="testUserSelect" class="devtools-select">
                                <option value="">Завантаження...</option>
                            </select>
                            <button class="devtools-btn" onclick="DashboardPage.switchTestUser()">▶</button>
                        </div>
                    </div>
                    ${statusHtml ? `<div class="devtools-section">${statusHtml}</div>` : ''}
                </div>
            </div>
        `;

        // Insert as first child
        grid.insertBefore(devTools, grid.firstChild);

        if (currentTestRole) {
            document.getElementById('testRoleSelect').value = currentTestRole;
        }

        // Load users for impersonation dropdown
        _loadUsersForDevtools();

        // Reset handlers
        const resetRoleBtn = document.getElementById('devtoolsResetRole');
        if (resetRoleBtn) resetRoleBtn.onclick = () => DashboardPage.resetTestRole();

        const resetImpBtn = document.getElementById('devtoolsResetImp');
        if (resetImpBtn) resetImpBtn.onclick = () => {
            if (typeof RoleSwitcher !== 'undefined') RoleSwitcher.resetImpersonation();
        };
    }

    async function _loadUsersForDevtools() {
        const select = document.getElementById('testUserSelect');
        if (!select) return;
        try {
            const resp = await fetch('/api/auth/users-list', {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
            });
            if (!resp.ok) throw new Error();
            const users = await resp.json();
            select.innerHTML = '<option value="">— Обрати юзера —</option>' +
                users.filter(u => u.username !== AppState.currentUser.username)
                    .map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${ROLE_NAMES[u.role] || escapeHtml(u.role)})</option>`)
                    .join('');
        } catch {
            select.innerHTML = '<option value="">Помилка</option>';
        }
    }

    async function switchTestUser() {
        const select = document.getElementById('testUserSelect');
        if (!select || !select.value) return;
        const userId = parseInt(select.value);
        if (typeof RoleSwitcher !== 'undefined') {
            // Use RoleSwitcher impersonation
            try {
                const resp = await fetch('/api/auth/impersonate', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token'), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId })
                });
                if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Failed');
                const data = await resp.json();
                sessionStorage.setItem('realToken', localStorage.getItem('pzp_token'));
                sessionStorage.setItem('realUser', JSON.stringify(AppState.currentUser));
                sessionStorage.setItem('impersonating', data.user.username);
                localStorage.setItem('pzp_token', data.token);
                localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(data.user));
                window.location.reload();
            } catch (err) {
                if (typeof showNotification === 'function') showNotification('Помилка: ' + err.message, 'error');
            }
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

    async function openTask(taskId) {
        // Fetch full task details
        try {
            const resp = await fetch(`/api/tasks/${taskId}`, {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const task = await resp.json();
            if (!task || !task.id) throw new Error('Task not found');

            showTaskModal(task);
        } catch (err) {
            console.error('Open task error:', err);
            // Fallback: navigate to tasks page
            window.location.href = '/tasks';
        }
    }

    function showTaskModal(t) {
        // Remove previous if open
        const prev = document.getElementById('dashTaskModal');
        if (prev) prev.remove();

        const priorityLabels = { critical: 'Критичний', high: 'Високий', medium: 'Середній', low: 'Низький' };
        const statusLabels = { todo: 'Todo', in_progress: 'В роботі', done: 'Готово', cancelled: 'Скасовано' };
        const catLabels = { event: '🎉 Івент', purchase: '🛒 Закупівлі', admin: '📎 Адмін', trampoline: '🤸 Батути', personal: '👤 Особисті', improvement: '⚡ Покращення' };

        const priorityCls = t.priority === 'high' || t.priority === 'critical' ? 'high' : t.priority === 'low' ? 'low' : 'medium';

        let deadlineHtml = '';
        if (t.deadline) {
            const dl = new Date(t.deadline);
            const now = new Date();
            const isOverdue = dl < now;
            const dlStr = dl.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            deadlineHtml = `<div class="task-modal-row"><span class="task-modal-label">Дедлайн:</span> <span class="${isOverdue ? 'text-danger' : ''}">${dlStr}${isOverdue ? ' (протерміновано!)' : ''}</span></div>`;
        }

        const modal = document.createElement('div');
        modal.id = 'dashTaskModal';
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.innerHTML = `
            <div class="modal-content">
                <span class="modal-close" onclick="document.getElementById('dashTaskModal')?.remove()">&times;</span>
                <div class="task-modal-header">
                    <span class="task-modal-priority ${priorityCls}"></span>
                    <h3>${escapeHtml(t.title)}</h3>
                </div>
                <div class="task-modal-body">
                    <div class="task-modal-row"><span class="task-modal-label">Статус:</span> ${statusLabels[t.status] || t.status}</div>
                    <div class="task-modal-row"><span class="task-modal-label">Пріоритет:</span> ${priorityLabels[t.priority] || t.priority}</div>
                    <div class="task-modal-row"><span class="task-modal-label">Категорія:</span> ${catLabels[t.category] || t.category || '—'}</div>
                    ${t.assigned_to ? `<div class="task-modal-row"><span class="task-modal-label">Відповідальний:</span> ${escapeHtml(t.assigned_to)}</div>` : ''}
                    ${t.owner ? `<div class="task-modal-row"><span class="task-modal-label">Власник:</span> ${escapeHtml(t.owner)}</div>` : ''}
                    ${deadlineHtml}
                    ${t.date ? `<div class="task-modal-row"><span class="task-modal-label">Дата:</span> ${new Date(t.date).toLocaleDateString('uk-UA')}</div>` : ''}
                    ${t.description ? `<div class="task-modal-description"><span class="task-modal-label">Опис:</span><p>${escapeHtml(t.description)}</p></div>` : ''}
                    ${t.notes ? `<div class="task-modal-description"><span class="task-modal-label">Нотатки:</span><p>${escapeHtml(t.notes)}</p></div>` : ''}
                </div>
                <div class="task-modal-footer">
                    <a href="/tasks" class="dashboard-btn primary">Відкрити на сторінці задач</a>
                    <button class="dashboard-btn" onclick="document.getElementById('dashTaskModal')?.remove()">Закрити</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    function refreshWorkQueue() {
        loadWorkQueue();
    }

    function setWorkQueueReplyScope(scope) {
        _workQueueReplyScope = normalizeWorkQueueReplyScope(scope);
        localStorage.setItem('eg_reply_backlog_scope', _workQueueReplyScope);
        renderWorkQueueScopeControls({ replyBacklog: { scope: _workQueueReplyScope } });
        loadWorkQueue();
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
        refreshWorkQueue,
        setWorkQueueReplyScope,
        refreshWidget,
        openTask,
        toggleOnboardingWidget,
        saveOnboarding,
        openSettings,
        toggleSettingsWidget,
        saveSettings,
        switchTestRole,
        resetTestRole,
        switchTestUser,
    };
})();

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    DashboardPage.init();
});
