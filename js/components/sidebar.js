/**
 * js/components/sidebar.js — Sidebar Navigation v34.0.0
 * Accordion groups, unified nav, all pages consistent
 */
const Sidebar = (() => {
    // ═══ NAV_ITEMS ════════════════════════════════════════════════
    const NAV_ITEMS = [
        // ─── GROUP: CRM ──────────────────────────────────────────
        { type: 'group', key: 'crm', label: 'CRM', icon: '📋', defaultOpen: false },
        { href: '/dashboard',    icon: '🏠', label: 'Дашборд',       access: 'all',            group: 'crm' },
        { href: '/',             icon: '📅', label: 'Таймлайн',       access: 'timeline',       group: 'crm' },
        { href: '/tasks',        icon: '✅', label: 'Задачі',         access: 'all',            group: 'crm' },
        { href: '/chat',         icon: '💬', label: 'Чат',            access: 'all',            group: 'crm' },
        { href: '/warehouse',    icon: '📦', label: 'Склад',          access: 'all',            group: 'crm' },
        { href: '/center',       icon: '💲', label: 'Центр цін',      access: 'center',         group: 'crm' },

        // ─── GROUP: Управління ───────────────────────────────────
        { type: 'group', key: 'mgmt', label: 'Управління', icon: '👔', defaultOpen: false },
        { href: '/customers',    icon: '👥', label: 'Клієнти',        access: 'management',     group: 'mgmt' },
        { href: '/sales-funnel', icon: '🔥', label: 'Ліди',          access: 'leads',          group: 'mgmt' },
        { href: '/finance',      icon: '💰', label: 'Фінанси',        access: 'finance',        group: 'mgmt' },
        { href: '/analytics',    icon: '📊', label: 'Аналітика',      access: 'analytics',      group: 'mgmt' },
        { href: '/reports',      icon: '📋', label: 'Звіти',          access: 'reports',        group: 'mgmt' },
        { href: '/copilot',      icon: '🤖', label: 'Менеджер AI',    access: 'copilot',        group: 'mgmt' },

        // ─── GROUP: HR ───────────────────────────────────────────
        { type: 'group', key: 'hr', label: 'HR', icon: '🤝', defaultOpen: false },
        { href: '/staff',        icon: '🗓️', label: 'Графік',         access: 'schedule_daily', group: 'hr', staffView: 'schedule' },
        { href: '/staff',        icon: '📋', label: 'Команда',        access: 'staff',          group: 'hr', staffView: 'team', noActive: true },
        { href: '/hr',           icon: '🤝', label: 'Кадри',          access: 'hr_page',        group: 'hr' },
        { href: '/training',     icon: '🎓', label: 'Навчання',       access: 'all',            group: 'hr' },

        // ─── GROUP: Творче ───────────────────────────────────────
        { type: 'group', key: 'creative', label: 'Творче', icon: '🎨', defaultOpen: false },
        { href: '/programs',     icon: '🎪', label: 'Програми',       access: 'programs',       group: 'creative' },
        { href: '/art',          icon: '🎨', label: 'Art Director',   access: 'art',            group: 'creative' },
        { href: '/designer',     icon: '📐', label: 'Дизайнер',       access: 'art',            group: 'creative' },
        { href: '/sound',        icon: '🔊', label: 'Звук',           access: 'art',            group: 'creative' },
        { href: '/graduation',   icon: '🎓', label: 'Випускний',      access: 'graduation',     group: 'creative' },
        { href: '/art',          icon: '📂', label: 'Каталоги',       access: 'art',            group: 'creative', noActive: true },
        // E4/E5 FIX: Афіша і Сертифікати — action-links
        { href: '#afisha',       icon: '🎭', label: 'Афіша',          access: 'all',            group: 'creative',
          action: 'sidebarOpenAfisha',       isHashLink: true },
        { href: '#certificates', icon: '🎫', label: 'Сертифікати',    access: 'all',            group: 'creative',
          action: 'sidebarOpenCertificates', isHashLink: true },

        // ─── GROUP: Система ──────────────────────────────────────
        { type: 'group', key: 'system', label: 'Система', icon: '⚙️', defaultOpen: false },
        { href: '/kleshnya',     icon: '🦞', label: 'Клешня',         access: 'all',            group: 'system' },
        { href: '/game',         icon: '🎮', label: 'Гра',            access: 'all',            group: 'system' },
        { href: '/demo',         icon: '🎬', label: 'Demo',           access: 'demo',           group: 'system' },
        { href: '#settings',     icon: '⚙️', label: 'Налаштування',   access: 'settings',       group: 'system',
          action: 'sidebarOpenSettings', isHashLink: true },
    ];

    // ═══ ACCESS MATRIX ════════════════════════════════════════════
    const ALL = true;
    const SIDEBAR_ACCESS = {
        all:            ALL,
        timeline:       ['creator','director','vice_director','senior_manager','manager','admin','senior_instructor','instructor','hr','accountant','it_specialist'],
        management:     ['creator','director','vice_director','senior_manager','manager','admin','marketer'],
        leads:          ['creator','director','vice_director','senior_manager','manager','marketer'],
        copilot:        ['creator','director','senior_manager','manager'],
        staff:          ['creator','director','vice_director','senior_manager','manager','admin','hr','senior_instructor','instructor','it_specialist'],
        hr:             ['creator','director','vice_director','senior_manager','manager','hr'],
        hr_page:        ['creator','director','vice_director','senior_manager','manager','hr'],
        finance:        ['creator','director','vice_director','accountant','senior_manager','manager'],
        analytics:      ['creator','director','vice_director','senior_manager','manager','accountant','marketer','it_specialist'],
        reports:        ['creator','director','vice_director','senior_manager','manager','admin','accountant'],
        programs:       ['creator','director','vice_director','senior_manager','manager','admin','senior_instructor','instructor','art_director'],
        center:         ['creator','director','vice_director','senior_manager','manager','admin','accountant'],
        graduation:     ['creator','director','vice_director','senior_manager','manager','admin','art_director','marketer'],
        art:            ['creator','director','vice_director','senior_manager','manager','art_director','marketer'],
        demo:           ['creator','director','vice_director'],
        settings:       ['creator','director'],
        schedule_daily: ['creator','director','vice_director','senior_manager','manager','admin','senior_instructor','instructor','hr','it_specialist'],
    };

    // ═══ ACCORDION STATE ══════════════════════════════════════════
    function _getGroupState() {
        try { return JSON.parse(localStorage.getItem('pzp_sidebar_groups') || '{}'); }
        catch { return {}; }
    }
    function _setGroupState(key, open) {
        const s = _getGroupState();
        s[key] = open;
        localStorage.setItem('pzp_sidebar_groups', JSON.stringify(s));
    }
    function _isGroupOpen(key, defaultOpen) {
        const s = _getGroupState();
        return key in s ? s[key] : (defaultOpen !== false);
    }

    // ═══ RENDER ═══════════════════════════════════════════════════
    function render(containerSelector) {
        const container = document.querySelector(containerSelector || '#sidebarNav .sidebar-links');
        if (!container) return;
        const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        const role = typeof getUserRole === 'function' ? getUserRole() : null;

        let currentGroupKey = null;
        let html = '';

        for (const item of NAV_ITEMS) {
            // ── Group header ──────────────────────────────────────
            if (item.type === 'group') {
                // Close previous group
                if (currentGroupKey !== null) {
                    html += '</div></div></div>'; // inner + items + group
                }
                currentGroupKey = item.key;

                // Check if group has accessible children
                const hasChildren = NAV_ITEMS.some(c =>
                    c.group === item.key && (!role || hasAccess(c, role))
                );
                if (!hasChildren) { currentGroupKey = '__skip__'; continue; }

                // Force open if current page is in this group
                const hasActive = NAV_ITEMS.some(c =>
                    c.group === item.key && !c.noActive && !c.isHashLink &&
                    (currentPath === c.href || (c.href !== '/' && !c.href.startsWith('#') && currentPath.startsWith(c.href)))
                );
                const finalOpen = hasActive || _isGroupOpen(item.key, item.defaultOpen);

                html += `
<div class="sidebar-group" data-group-key="${item.key}">
  <button class="sidebar-group-header${finalOpen ? ' open' : ''}"
          onclick="Sidebar.toggleGroup('${item.key}', this)"
          title="${item.label}">
    <span class="nav-icon">${item.icon}</span>
    <span class="nav-text sidebar-group-label">${item.label}</span>
    <span class="sidebar-group-arrow"></span>
  </button>
  <div class="sidebar-group-items${finalOpen ? ' open' : ''}">
    <div class="sidebar-group-inner">`;
                continue;
            }

            // Skip if group is blocked
            if (currentGroupKey === '__skip__') continue;

            // ── Skip no access ────────────────────────────────────
            if (role && !hasAccess(item, role)) continue;

            // ── Render nav-link ───────────────────────────────────
            const isActive = !item.noActive && !item.isHashLink && (
                currentPath === item.href ||
                (item.href !== '/' && !item.href.startsWith('#') && currentPath.startsWith(item.href))
            );

            // E9 FIX: simplified onclick
            let onclickAttr = '';
            if (item.action) {
                onclickAttr = ` onclick="event.preventDefault();if(typeof ${item.action}==='function')${item.action}();"`;
            }

            html += `<a href="${item.href}" class="nav-link${isActive ? ' active' : ''}" data-page-access="${item.href}"${onclickAttr}>
  <span class="nav-icon">${item.icon}</span>
  <span class="nav-text">${item.label}</span>
</a>`;
        }

        // Close last group
        if (currentGroupKey && currentGroupKey !== '__skip__') {
            html += '</div></div></div>';
        }

        container.innerHTML = html;
        container.classList.add('rendered');

        _initCollapsedTooltips(container);
        _fetchLiveBadges();
    }

    // ═══ TOGGLE GROUP ══════════════════════════════════════════════
    function toggleGroup(key, btn) {
        if (!btn) return;
        const group = btn.closest('.sidebar-group');
        if (!group) return;
        const items = group.querySelector('.sidebar-group-items');
        if (!items) return;
        const isOpen = items.classList.contains('open');
        items.classList.toggle('open', !isOpen);
        btn.classList.toggle('open', !isOpen);
        _setGroupState(key, !isOpen);
    }

    // ═══ ACCESS CHECK ══════════════════════════════════════════════
    function hasAccess(item, role) {
        const access = SIDEBAR_ACCESS[item.access];
        if (access === true) return true;
        if (!access) return false;
        return access.includes(role);
    }

    // ═══ COLLAPSED TOOLTIPS ═══
    function _initCollapsedTooltips(container) {
        container.querySelectorAll('.nav-link').forEach(el => {
            const label = el.querySelector('.nav-text')?.textContent;
            if (!label) return;
            let tooltip = null;
            el.addEventListener('mouseenter', () => {
                if (!document.getElementById('sidebarNav')?.classList.contains('collapsed')) return;
                tooltip = document.createElement('div');
                tooltip.className = 'nav-tooltip';
                tooltip.textContent = label;
                document.body.appendChild(tooltip);
                const rect = el.getBoundingClientRect();
                tooltip.style.cssText = `position:fixed;left:${rect.right+8}px;top:${rect.top+rect.height/2}px;transform:translateY(-50%);background:#1e293b;color:#fff;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:600;z-index:9999;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.2);animation:tooltipIn 0.15s ease-out both;`;
            });
            el.addEventListener('mouseleave', () => { if (tooltip) { tooltip.remove(); tooltip = null; } });
        });
    }

    // ═══ LIVE BADGES ═══
    async function _fetchLiveBadges() {
        const token = localStorage.getItem('pzp_token');
        if (!token) return;
        try {
            const [alertsR, leadsR] = await Promise.allSettled([
                fetch('/api/dashboard/alerts', { headers: { 'Authorization': 'Bearer ' + token } }).then(r => r.json()),
                fetch('/api/leads/new-count', { headers: { 'Authorization': 'Bearer ' + token } }).then(r => r.json()).catch(() => null),
            ]);
            const alertCount = alertsR.status === 'fulfilled' ? (alertsR.value?.count || 0) : 0;
            const leadsNew = leadsR.status === 'fulfilled' ? (leadsR.value?.count || 0) : 0;
            _setBadge('alerts', alertCount > 0 ? alertCount : null);
            _setBadge('leads_new', leadsNew > 0 ? leadsNew : null);
        } catch {}
        const chatUnread = typeof ChatState !== 'undefined' ? (ChatState.totalUnread || 0) : 0;
        _setBadge('unread', chatUnread > 0 ? chatUnread : null);
        setTimeout(_fetchLiveBadges, 300000);
    }

    function _setBadge(type, value) {
        document.querySelectorAll(`[data-badge-type="${type}"]`).forEach(el => {
            if (value === null || value === undefined || value === 0) {
                el.style.display = 'none';
            } else {
                el.style.display = 'inline-flex';
                el.textContent = typeof value === 'number' && value > 99 ? '99+' : String(value);
            }
        });
    }

    // ═══ USER CARD ═══
    function initUserCard() {
        const user = typeof AppState !== 'undefined' ? AppState.currentUser : null;
        if (!user) return;
        const avatarEl = document.getElementById('sidebarUserAvatar');
        const nameEl = document.getElementById('sidebarUserName');
        const roleEl = document.getElementById('sidebarUserRole');
        const LABELS = { creator:'🏆 Creator', director:'🦁 Директор', vice_director:'🌟 Заст. директора',
            senior_manager:'📋 Ст. менеджер', manager:'📋 Менеджер', admin:'👑 Адмін',
            hr:'🤝 HR', accountant:'💰 Бухгалтер', animator:'🎭 Аніматор',
            instructor:'🎓 Інструктор', art_director:'🎨 Арт директор' };
        if (avatarEl) {
            avatarEl.textContent = (user.name || '?').charAt(0).toUpperCase();
            const colors = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444'];
            avatarEl.style.background = colors[(user.id || 0) % colors.length];
        }
        if (nameEl) nameEl.textContent = user.name || user.username || '';
        if (roleEl) roleEl.textContent = LABELS[user.role] || user.role || '';
    }

    // ═══ TOGGLE SIDEBAR (mobile/desktop) ══════════════════════════
    function initToggle() {
        const toggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebarNav');
        const overlay = document.getElementById('sidebarOverlay');
        if (toggle && sidebar) {
            toggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
                if (overlay) overlay.classList.toggle('active');
            });
        }
        if (overlay && sidebar) {
            overlay.addEventListener('click', () => {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
            });
        }
        if (sidebar) {
            sidebar.addEventListener('click', (e) => {
                const link = e.target.closest('.nav-link');
                if (!link) return;
                if (window.innerWidth <= 768 && overlay) { sidebar.classList.remove('open'); overlay.classList.remove('active'); }
            });
        }
        // Theme toggle — inject before collapse button
        _initThemeToggle(sidebar);

        // Collapse button — graceful (може не бути на всіх сторінках)
        const collapseBtn = document.getElementById('sidebarCollapseBtn');
        if (collapseBtn && sidebar) {
            const collapsed = localStorage.getItem('pzp_sidebar_collapsed') === 'true';
            if (collapsed) sidebar.classList.add('collapsed');
            collapseBtn.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
                localStorage.setItem('pzp_sidebar_collapsed', sidebar.classList.contains('collapsed'));
            });
        }
    }

    function _initThemeToggle(sidebar) {
        if (!sidebar) return;
        // Don't duplicate
        if (sidebar.querySelector('.sidebar-theme-btn')) return;
        const collapseBtn = sidebar.querySelector('#sidebarCollapseBtn');
        if (!collapseBtn) return;

        const isDark = document.body.classList.contains('dark-mode');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sidebar-theme-btn';
        btn.title = 'Змінити тему';
        btn.innerHTML = `<span class="nav-icon">${isDark ? '☀️' : '🌙'}</span><span class="nav-text">${isDark ? 'Світла тема' : 'Темна тема'}</span>`;

        btn.addEventListener('click', () => {
            const nowDark = document.body.classList.toggle('dark-mode');
            localStorage.setItem('pzp_dark_mode', String(nowDark));
            document.documentElement.setAttribute('data-theme', nowDark ? 'dark' : 'light');
            btn.querySelector('.nav-icon').textContent = nowDark ? '☀️' : '🌙';
            btn.querySelector('.nav-text').textContent = nowDark ? 'Світла тема' : 'Темна тема';
            // Sync hidden checkbox if exists (for app.js compatibility)
            const cb = document.getElementById('darkModeToggle');
            if (cb) cb.checked = nowDark;
            if (typeof AppState !== 'undefined') AppState.darkMode = nowDark;
        });

        collapseBtn.parentNode.insertBefore(btn, collapseBtn);
    }

    function checkPageAccess() {
        const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        if (typeof canAccessPage === 'function' && !canAccessPage(currentPath)) {
            window.location.href = '/';
        }
    }

    function init(containerSelector) {
        render(containerSelector);
        initToggle();
    }

    window.addEventListener('roleSwitched', () => {
        const c = document.querySelector('#sidebarLinks') || document.querySelector('#sidebarNav .sidebar-links');
        if (c) render('#' + c.id);
    });

    // ─── Sidebar action helpers ──────────────────────────────────
    // On timeline (index.html) — open modal directly
    // On other pages — redirect to / with ?open= parameter
    window.sidebarOpenAfisha = function() {
        if (typeof showAfishaModal === 'function') {
            showAfishaModal();
        } else {
            window.location.href = '/?open=afisha';
        }
    };
    window.sidebarOpenCertificates = function() {
        if (typeof openCertificatesPanel === 'function') {
            openCertificatesPanel();
        } else {
            window.location.href = '/?open=certificates';
        }
    };
    window.sidebarOpenSettings = function() {
        if (typeof showSettings === 'function') {
            showSettings();
        } else {
            window.location.href = '/?open=settings';
        }
    };

    return { init, render, initToggle, checkPageAccess, toggleGroup, initUserCard, NAV_ITEMS, SIDEBAR_ACCESS, hasAccess };
})();
