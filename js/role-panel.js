/**
 * js/role-panel.js — Global Role Panel FAB + slide-out panel
 * v24.1.0: QA fixes + Polish — stagger animations, task counter, impersonation banner, z-index fixes
 *
 * Blocks:
 * 1. Schedule link (all roles)
 * 2. My tasks today (all roles)
 * 3. My shift (all roles)
 * 4. Dashboard today (admin+)
 * 5. Team now (manager+)
 * 6. System alerts (director+)
 */

const RolePanel = (() => {
    let _open = false;
    let _cache = null;
    let _cacheTime = 0;
    const CACHE_TTL = 60000; // 60s

    // Role hierarchy levels for block visibility
    const ROLE_LEVEL = {
        waiter: 0, dishwasher: 1, maintenance: 2, cleaning: 3, wardrobe: 4, barista: 5,
        reception: 6, animator: 7, pastry_chef: 8, head_pastry: 9, cook: 10, head_chef: 11,
        instructor: 12, senior_instructor: 13, admin: 14, hr: 15, it_specialist: 16,
        marketer: 17, art_director: 18, accountant: 19, manager: 20, senior_manager: 21,
        vice_director: 22, director: 23, creator: 24
    };

    const ROLE_NAMES = {
        creator: 'Творець', director: 'Директор', vice_director: 'Заст. директора',
        senior_manager: 'Старший менеджер', manager: 'Менеджер',
        accountant: 'Бухгалтер', art_director: 'Арт-директор', marketer: 'Маркетолог',
        it_specialist: 'IT-спеціаліст', hr: 'HR-менеджер', admin: 'Адміністратор',
        senior_instructor: 'Старший інструктор', instructor: 'Інструктор',
        head_chef: 'Шеф-кухар', cook: 'Кухар', head_pastry: 'Шеф-кондитер',
        pastry_chef: 'Кондитер', animator: 'Аніматор', reception: 'Рецепція',
        barista: 'Бариста', wardrobe: 'Гардеробник', cleaning: 'Клінінг',
        maintenance: 'Технік', dishwasher: 'Посудомийник', waiter: 'Офіціант'
    };

    function _getRole() {
        // Respect test role from Role Switcher
        if (typeof getUserRole === 'function') return getUserRole();
        const testRole = sessionStorage.getItem('testRole') || localStorage.getItem('pzp_test_role');
        if (testRole) return testRole;
        try {
            const user = JSON.parse(localStorage.getItem('pzp_current_user'));
            return user ? user.role : null;
        } catch { return null; }
    }

    function _getUser() {
        if (typeof AppState !== 'undefined' && AppState.currentUser) return AppState.currentUser;
        try { return JSON.parse(localStorage.getItem('pzp_current_user')); } catch { return null; }
    }

    function _getHeaders() {
        const token = localStorage.getItem('pzp_token');
        const h = {};
        if (token) h['Authorization'] = 'Bearer ' + token;
        return h;
    }

    function _level(role) { return ROLE_LEVEL[role] ?? -1; }

    function init() {
        // Don't init on login-only pages or if no token
        if (!localStorage.getItem('pzp_token')) return;

        // Inject FAB — vertical capsule design
        const fab = document.createElement('button');
        fab.id = 'rolePanelFab';
        fab.className = 'role-panel-fab';
        fab.setAttribute('aria-label', 'Відкрити панель ролі');
        fab.innerHTML = `
            <span class="rp-fab-icon">👤</span>
            <span class="rp-fab-label">Панель</span>
        `;
        document.body.appendChild(fab);

        // Inject overlay
        const overlay = document.createElement('div');
        overlay.id = 'rolePanelOverlay';
        overlay.className = 'role-panel-overlay';
        document.body.appendChild(overlay);

        // Inject panel
        const panel = document.createElement('aside');
        panel.id = 'rolePanel';
        panel.className = 'role-panel';
        panel.innerHTML = `
            <div class="role-panel-header">
                <div class="role-panel-header-info">
                    <div class="role-panel-user-name" id="rpUserName"></div>
                    <div class="role-panel-user-role" id="rpUserRole"></div>
                </div>
                <button class="role-panel-close" id="rpClose" aria-label="Закрити">&times;</button>
            </div>
            <div class="role-panel-content" id="rpContent">
                <div class="rp-empty">Завантаження...</div>
            </div>
        `;
        document.body.appendChild(panel);

        // Event listeners
        fab.addEventListener('click', toggle);
        overlay.addEventListener('click', close);
        document.getElementById('rpClose').addEventListener('click', close);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && _open) close();
        });

        // Listen for role switch events
        window.addEventListener('roleSwitched', () => {
            _cache = null;
            _cacheTime = 0;
            if (_open) _loadAndRender();
        });

        // v24.1.0: Show impersonation banner on F5/reload
        _checkImpersonationBanner();

        // v24.1.0: Update FAB badge if test role is active
        _updateFabBadge();
    }

    function _checkImpersonationBanner() {
        const imp = sessionStorage.getItem('impersonating');
        if (!imp) return;

        // Don't duplicate
        if (document.getElementById('impersonationBanner')) return;

        const banner = document.createElement('div');
        banner.id = 'impersonationBanner';
        banner.className = 'impersonation-banner';
        banner.innerHTML = `
            <span>👤 Ви переглядаєте як: <b>${_esc(imp)}</b> — дані відповідають цьому користувачу</span>
            <button class="impersonation-return-btn" id="impReturnBtn">Повернутись</button>
        `;
        document.body.prepend(banner);
        document.body.classList.add('has-impersonation-banner');

        document.getElementById('impReturnBtn').addEventListener('click', () => {
            if (typeof RoleSwitcher !== 'undefined') {
                RoleSwitcher.resetImpersonation();
            }
        });
    }

    function _updateFabBadge() {
        const fab = document.getElementById('rolePanelFab');
        if (!fab) return;
        const testRole = sessionStorage.getItem('testRole') || localStorage.getItem('pzp_test_role');
        const imp = sessionStorage.getItem('impersonating');
        if (testRole || imp) {
            fab.classList.add('has-badge');
        } else {
            fab.classList.remove('has-badge');
        }
    }

    function toggle() {
        _open ? close() : open();
    }

    function open() {
        _open = true;
        document.getElementById('rolePanel').classList.add('open');
        document.getElementById('rolePanelOverlay').classList.add('active');
        _loadAndRender();
    }

    function close() {
        _open = false;
        document.getElementById('rolePanel').classList.remove('open');
        document.getElementById('rolePanelOverlay').classList.remove('active');
    }

    async function _loadAndRender() {
        const user = _getUser();
        const role = _getRole();
        if (!user || !role) return;

        // Update header
        const testRole = sessionStorage.getItem('testRole') || localStorage.getItem('pzp_test_role');
        const imp = sessionStorage.getItem('impersonating');
        const nameEl = document.getElementById('rpUserName');
        const roleEl = document.getElementById('rpUserRole');

        nameEl.textContent = user.name;
        let roleText = ROLE_NAMES[role] || role;
        let noteHtml = '';
        if (imp) {
            roleText = '👤 Імперсонація: ' + imp;
        } else if (testRole && user.role === 'creator') {
            roleText = '🎭 Тест: ' + (ROLE_NAMES[testRole] || testRole);
            noteHtml = '<div class="rp-test-note">Тільки зовнішній вигляд. Дані залишаються як у creator.</div>';
        }
        roleEl.innerHTML = _esc(roleText) + noteHtml;

        const content = document.getElementById('rpContent');
        const now = Date.now();

        // Use cache if fresh
        if (_cache && (now - _cacheTime) < CACHE_TTL) {
            _renderBlocks(content, role, _cache);
            return;
        }

        content.innerHTML = '<div class="rp-empty">Завантаження...</div>';

        // Fetch data in parallel
        const today = new Date().toISOString().split('T')[0];
        const level = _level(role);
        const headers = _getHeaders();

        const fetches = [
            // 0: tasks
            fetch('/api/tasks?assigned_to=me&status=todo,in_progress&limit=5', { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
            // 1: profile (has shift info)
            fetch('/api/auth/profile', { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
        ];

        // 2: Stats today (admin+) — use quick_stats widget endpoint
        if (level >= _level('admin')) {
            fetches.push(
                fetch('/api/dashboard/widgets/quick_stats', { headers }).then(r => r.ok ? r.json() : null).catch(() => null)
            );
        }

        // 3: Team online (manager+) — use team_online widget endpoint
        if (level >= _level('manager')) {
            fetches.push(
                fetch('/api/dashboard/widgets/team_online', { headers }).then(r => r.ok ? r.json() : null).catch(() => null)
            );
        }

        // 4+5: Alerts (director+)
        if (level >= _level('director')) {
            fetches.push(
                fetch('/api/tasks?status=todo&overdue=true&limit=5', { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
                fetch('/api/leads?unassigned=true&limit=5', { headers }).then(r => r.ok ? r.json() : null).catch(() => null)
            );
        }

        const results = await Promise.allSettled(fetches);
        const get = (i) => results[i] && results[i].status === 'fulfilled' ? results[i].value : null;

        // Extract widget data from { success, data } wrapper
        const getWidget = (i) => {
            const r = get(i);
            return r && r.data ? r.data : r;
        };

        _cache = {
            tasks: get(0),
            profile: get(1),
            stats: level >= _level('admin') ? getWidget(2) : null,
            team: level >= _level('manager') ? getWidget(level >= _level('admin') ? 3 : 2) : null,
            overdueTasks: level >= _level('director') ? get(level >= _level('admin') ? 4 : 3) : null,
            leads: level >= _level('director') ? get(level >= _level('admin') ? 5 : 4) : null,
        };
        _cacheTime = now;

        _renderBlocks(content, role, _cache);
    }

    function _renderBlocks(container, role, data) {
        const level = _level(role);
        let html = '';

        // Block 1: Schedule link
        html += _renderScheduleBlock(data);

        // Block 2: My tasks
        html += _renderTasksBlock(data);

        // Block 3: My shift
        html += _renderShiftBlock(data);

        // Block 4: Dashboard today (admin+, level >= 14)
        if (level >= _level('admin')) {
            html += _renderStatsBlock(data);
        }

        // Block 5: Team now (manager+, level >= 20)
        if (level >= _level('manager')) {
            html += _renderTeamBlock(data);
        }

        // Block 6: System alerts (director+, level >= 23)
        if (level >= _level('director')) {
            html += _renderAlertsBlock(data);
        }

        container.innerHTML = html;

        // Bind task checkboxes
        container.querySelectorAll('.rp-task-check:not(.done)').forEach(btn => {
            btn.addEventListener('click', async () => {
                const taskId = btn.dataset.taskId;
                try {
                    const resp = await fetch(`/api/auth/tasks/${taskId}/quick-status`, {
                        method: 'PATCH',
                        headers: { ..._getHeaders(), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'done' })
                    });
                    if (resp.ok) {
                        btn.classList.add('done');
                        btn.innerHTML = '✓';
                        const item = btn.closest('.rp-task-item');
                        item.classList.add('completing');
                        // Update counter
                        const titleEl = item.closest('.role-panel-block')?.querySelector('.role-panel-block-title');
                        if (titleEl) {
                            const match = titleEl.textContent.match(/(\d+)/);
                            if (match) {
                                const newCount = Math.max(0, parseInt(match[1]) - 1);
                                titleEl.innerHTML = `<span class="block-icon">📝</span> Задачі: ${newCount} невиконано`;
                                if (newCount === 0) {
                                    const list = item.closest('.rp-task-list');
                                    if (list) {
                                        setTimeout(() => { list.innerHTML = '<div class="rp-empty">✅ Задач немає — відпочивай!</div>'; }, 350);
                                    }
                                }
                            }
                        }
                        // Remove item after animation
                        setTimeout(() => { item.remove(); }, 350);
                        _cache = null; // invalidate cache
                    }
                } catch { /* silent */ }
            });
        });

        // v24.1.0: Stagger animation — blocks appear one by one
        _animateBlocksIn(container);
    }

    function _animateBlocksIn(container) {
        const blocks = container.querySelectorAll('.role-panel-block, .role-panel-schedule-btn');
        blocks.forEach(b => b.classList.remove('rp-visible'));
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                blocks.forEach(b => b.classList.add('rp-visible'));
            });
        });
    }

    function _renderScheduleBlock(data) {
        const profile = data.profile;
        let subText = 'Переглянути графік';
        if (profile && profile.todayShift) {
            const s = profile.todayShift;
            subText = `Зміна: ${s.start || '?'} – ${s.end || '?'}`;
        } else if (profile) {
            subText = 'Сьогодні вихідний';
        }

        return `
            <a href="/staff" class="role-panel-schedule-btn">
                <span>👥 Мій графік на сьогодні</span>
                <span class="btn-arrow">→</span>
            </a>
            <div style="text-align:center; font-size:12px; color:var(--gray-400,#a0aec0); margin-top:-6px;">${_esc(subText)}</div>
        `;
    }

    function _renderTasksBlock(data) {
        const tasks = data.tasks;
        let items = [];

        // Handle different response shapes
        if (tasks && Array.isArray(tasks)) {
            items = tasks;
        } else if (tasks && tasks.tasks && Array.isArray(tasks.tasks)) {
            items = tasks.tasks;
        } else if (tasks && tasks.items && Array.isArray(tasks.items)) {
            items = tasks.items;
        }

        const count = items.length;

        let tasksHtml = '';
        if (count === 0) {
            tasksHtml = '<div class="rp-empty">✅ Задач немає — відпочивай!</div>';
        } else {
            tasksHtml = '<div class="rp-task-list">';
            items.slice(0, 5).forEach(t => {
                const priorityCls = t.priority === 'critical' ? 'critical' : t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'medium' : '';
                const deadline = t.deadline ? new Date(t.deadline).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
                tasksHtml += `
                    <div class="rp-task-item">
                        <button class="rp-task-check" data-task-id="${t.id}" title="Виконано"></button>
                        <span class="rp-task-title">${_esc(t.title)}</span>
                        ${priorityCls ? `<span class="rp-task-priority ${priorityCls}">!</span>` : ''}
                        ${deadline ? `<span class="rp-task-time">${deadline}</span>` : ''}
                    </div>`;
            });
            tasksHtml += '</div>';
        }

        return `
            <div class="role-panel-block">
                <div class="role-panel-block-title">
                    <span class="block-icon">📝</span> Задачі: ${count} невиконано
                </div>
                ${tasksHtml}
                <a href="/tasks" class="rp-stat-link">Всі задачі →</a>
            </div>
        `;
    }

    function _renderShiftBlock(data) {
        const profile = data.profile;
        const shift = profile ? profile.todayShift : null;

        let shiftHtml = '';
        if (!shift) {
            shiftHtml = '<div class="rp-empty">— Сьогодні вихідний</div>';
        } else {
            // Check if shift starts soon
            let warning = '';
            if (shift.start) {
                const now = new Date();
                const [h, m] = shift.start.split(':').map(Number);
                const shiftStart = new Date(now); shiftStart.setHours(h, m, 0, 0);
                const diff = (shiftStart - now) / 60000; // minutes
                if (diff > 0 && diff < 120) {
                    warning = '<div class="rp-shift-warning">⚠️ Скоро зміна!</div>';
                }
            }

            shiftHtml = `
                ${warning}
                <div class="rp-shift-info">
                    ${shift.department ? `<div class="rp-shift-row"><span class="rp-shift-icon">📍</span> Зона: ${_esc(shift.department)}</div>` : ''}
                    <div class="rp-shift-row"><span class="rp-shift-icon">⏰</span> Час: ${shift.start || '?'} – ${shift.end || '?'}</div>
                </div>
            `;
        }

        return `
            <div class="role-panel-block">
                <div class="role-panel-block-title">
                    <span class="block-icon">🔄</span> Зміна сьогодні
                </div>
                ${shiftHtml}
            </div>
        `;
    }

    function _renderStatsBlock(data) {
        const stats = data.stats;
        if (!stats) return '';

        const bookings = stats.bookingsToday ?? stats.todayBookings ?? 0;
        const revenue = stats.revenueToday ?? stats.todayRevenue ?? stats.revenue ?? 0;
        const leads = stats.activeTasks ?? stats.newLeads ?? stats.leadsToday ?? 0;

        return `
            <div class="role-panel-block">
                <div class="role-panel-block-title">
                    <span class="block-icon">📊</span> Сьогодні
                </div>
                <div class="rp-stats-grid">
                    <div class="rp-stat-card">
                        <div class="rp-stat-value">${bookings}</div>
                        <div class="rp-stat-label">🎉 Бронювань</div>
                    </div>
                    <div class="rp-stat-card">
                        <div class="rp-stat-value">${_formatPrice(revenue)}</div>
                        <div class="rp-stat-label">💰 Виручка</div>
                    </div>
                    <div class="rp-stat-card">
                        <div class="rp-stat-value">${leads}</div>
                        <div class="rp-stat-label">📋 Задач</div>
                    </div>
                </div>
                <a href="/dashboard" class="rp-stat-link">Дашборд →</a>
            </div>
        `;
    }

    function _renderTeamBlock(data) {
        const team = data.team;
        if (!team) return '';

        let items = [];
        if (Array.isArray(team)) {
            items = team;
        } else if (team.online && Array.isArray(team.online)) {
            items = team.online;
        } else if (team.staff && Array.isArray(team.staff)) {
            items = team.staff;
        } else if (team.items && Array.isArray(team.items)) {
            items = team.items;
        }

        if (items.length === 0) {
            return `
                <div class="role-panel-block">
                    <div class="role-panel-block-title"><span class="block-icon">👥</span> На зміні зараз</div>
                    <div class="rp-empty">Немає даних</div>
                </div>`;
        }

        const teamHtml = items.slice(0, 5).map(m => {
            const status = m.status || 'off';
            const dotCls = status === 'working' || status === 'active' ? 'active' : status === 'soon' ? 'soon' : 'off';
            const statusText = status === 'working' || status === 'active' ? 'активна' : status === 'soon' ? 'скоро' : 'вихідна';
            return `<div class="rp-team-item">
                <span class="rp-team-dot ${dotCls}"></span>
                <span class="rp-team-name">${_esc(m.name || m.staff_name || '')}</span>
                <span class="rp-team-status">${statusText}</span>
            </div>`;
        }).join('');

        return `
            <div class="role-panel-block">
                <div class="role-panel-block-title">
                    <span class="block-icon">👥</span> На зміні зараз (${items.length})
                </div>
                <div class="rp-team-list">${teamHtml}</div>
                <a href="/staff" class="rp-stat-link">Графік команди →</a>
            </div>
        `;
    }

    function _renderAlertsBlock(data) {
        const overdue = data.overdueTasks;
        const leads = data.leads;

        let alerts = [];

        // Overdue tasks
        if (overdue) {
            const count = Array.isArray(overdue) ? overdue.length : (overdue.total || overdue.count || 0);
            if (count > 0) {
                alerts.push({ icon: '⚠️', text: `${count} задач прострочено`, href: '/tasks' });
            }
        }

        // Unassigned leads
        if (leads) {
            const count = Array.isArray(leads) ? leads.length : (leads.total || leads.count || 0);
            if (count > 0) {
                alerts.push({ icon: '🔥', text: `${count} нових лідів без менеджера`, href: '/customers' });
            }
        }

        if (alerts.length === 0) {
            return `
                <div class="role-panel-block">
                    <div class="role-panel-block-title"><span class="block-icon">🔔</span> Потребує уваги</div>
                    <div class="rp-empty">✅ Все під контролем</div>
                </div>`;
        }

        const alertsHtml = alerts.map(a =>
            `<a href="${a.href}" class="rp-alert-item">
                <span class="rp-alert-icon">${a.icon}</span>
                <span class="rp-alert-text">${_esc(a.text)}</span>
            </a>`
        ).join('');

        return `
            <div class="role-panel-block">
                <div class="role-panel-block-title">
                    <span class="block-icon">🔔</span> Потребує уваги
                </div>
                <div class="rp-alert-list">${alertsHtml}</div>
            </div>
        `;
    }

    function _esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _formatPrice(amount) {
        if (!amount) return '0 ₴';
        return Number(amount).toLocaleString('uk-UA') + ' ₴';
    }

    // Auto-init when DOM ready and user is authenticated
    document.addEventListener('DOMContentLoaded', () => {
        // Slight delay to ensure auth.js has run
        setTimeout(() => {
            if (localStorage.getItem('pzp_token')) {
                init();
            }
        }, 300);
    });

    return { init, open, close, toggle };
})();
