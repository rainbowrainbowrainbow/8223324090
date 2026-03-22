/**
 * js/components/sidebar.js — Sidebar Navigation v33.14.0
 * Hub navigation, live badges, user card, day context, collapsed tooltips
 */

const Sidebar = (() => {
    function _getRoleName() {
        try {
            const saved = localStorage.getItem('pzp_user');
            if (saved) {
                const u = JSON.parse(saved);
                const NAMES = { creator:'Творець', director:'Директор', admin:'Адмін', manager:'Менеджер',
                    senior_manager:'Ст. менеджер', animator:'Аніматор', hr:'HR', accountant:'Бухгалтер',
                    art_director:'Арт директор', instructor:'Інструктор' };
                return NAMES[u.role] || u.role || 'CRM';
            }
        } catch {} return 'CRM';
    }

    // ═══ NAV_ITEMS ═══
    const NAV_ITEMS = [
        { type: 'section', label: 'CRM', animate: true },
        { href: '/dashboard', icon: '🏠', label: 'Дашборд', access: 'all',
          badge: { type: 'alerts', color: 'red' } },
        { href: '/', icon: '📅', label: 'Таймлайн', access: 'timeline' },
        { href: '/tasks', icon: '✅', label: 'Задачі', access: 'all',
          badge: { type: 'tasks', color: 'purple' } },
        { href: '/chat', icon: '💬', label: 'Чат', access: 'all',
          badge: { type: 'unread', color: 'blue' } },

        { type: 'divider' },
        { type: 'section', label: 'Робота' },
        { type: 'hub', icon: '👥', label: 'Клієнти · Ліди', access: 'management',
          badge: { type: 'leads_new', color: 'green' },
          children: [
              { href: '/customers', label: 'Клієнти', icon: '👥' },
              { href: '/sales-funnel', label: 'Ліди', icon: '🔥', badge: { type: 'leads_new', color: 'green' } }
          ]
        },
        { type: 'hub', icon: '💰', label: 'Фінанси · Аналіт.', access: 'finance',
          children: [
              { href: '/finance', label: 'Фінанси', icon: '💰' },
              { href: '/analytics', label: 'Аналітика', icon: '📊' },
              { href: '/reports', label: 'Звіти', icon: '📋' }
          ]
        },
        { type: 'hub', icon: '🗓️', label: 'Команда · HR', access: 'staff',
          children: [
              { href: '/staff', label: 'Графік', icon: '🗓️' },
              { href: '/hr', label: 'Кадри', icon: '🤝' },
              { href: '/training', label: 'Навчання', icon: '🎓' }
          ]
        },
        { type: 'hub', icon: '📦', label: 'Склад · Ціни', access: 'all',
          badge: { type: 'stock_low', color: 'yellow' },
          children: [
              { href: '/warehouse', label: 'Склад', icon: '📦', badge: { type: 'stock_low', color: 'yellow' } },
              { href: '/center', label: 'Центр цін', icon: '💲' }
          ]
        },
        { href: '/copilot', icon: '🤖', label: 'Менеджер AI', access: 'copilot' },

        { type: 'divider' },
        { type: 'section', label: 'Продукт' },
        { href: '/programs', icon: '🎪', label: 'Програми', access: 'programs' },
        { href: '/art', icon: '🎨', label: 'Art Director', access: 'art' },

        { type: 'divider' },
        { href: '/game', icon: '🎮', label: 'Гра', access: 'all' },
        { href: '/?settings=open', icon: '⚙️', label: 'Налаштування', access: 'settings', action: 'showSettings' },
    ];

    // ═══ ACCESS MATRIX ═══
    const ALL = true;
    const SIDEBAR_ACCESS = {
        all: ALL,
        timeline: ['creator','director','vice_director','senior_manager','manager','admin','senior_instructor','instructor','hr','accountant','it_specialist'],
        management: ['creator','director','vice_director','senior_manager','manager','admin','marketer'],
        leads: ['creator','director','vice_director','senior_manager','manager','marketer'],
        copilot: ['creator','director','senior_manager','manager'],
        staff: ['creator','director','vice_director','senior_manager','manager','admin','hr','senior_instructor','instructor','it_specialist'],
        hr: ['creator','director','vice_director','senior_manager','manager','hr'],
        finance: ['creator','director','vice_director','accountant','senior_manager','manager'],
        analytics: ['creator','director','vice_director','senior_manager','manager','accountant','marketer','it_specialist'],
        reports: ['creator','director','vice_director','senior_manager','manager','admin','accountant'],
        programs: ['creator','director','vice_director','senior_manager','manager','admin','senior_instructor','instructor','art_director'],
        center: ['creator','director','vice_director','senior_manager','manager','admin','accountant'],
        art: ['creator','director','vice_director','senior_manager','manager','art_director','marketer'],
        demo: ['creator','director','vice_director'],
        settings: ['creator','director'],
    };

    let _pageStatuses = {};

    function hasAccess(item, role) {
        if (!item.access) return true;
        const access = SIDEBAR_ACCESS[item.access];
        if (access === true) return true;
        if (!access) return false;
        return access.includes(role);
    }

    function _hasHubAccess(item, role) {
        if (item.type !== 'hub') return hasAccess(item, role);
        if (item.access && !hasAccess(item, role)) return false;
        return item.children?.some(c => !c.access || hasAccess(c, role));
    }

    async function fetchStatuses() { /* disabled */ }

    // ═══ RENDER ═══
    function render(containerSelector) {
        const container = document.querySelector(containerSelector || '#sidebarNav .sidebar-links');
        if (!container) return;
        const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        const role = typeof getUserRole === 'function' ? getUserRole() : null;
        const filtered = _filterItems(NAV_ITEMS, role);

        let html = '';
        for (const item of filtered) {
            if (item.type === 'divider') { html += '<div class="sidebar-divider"></div>'; continue; }
            if (item.type === 'section') {
                const altText = item.animate ? (typeof item.animate === 'string' ? item.animate : _getRoleName()) : '';
                html += altText
                    ? `<span class="sidebar-section-label sidebar-section-animated" data-label="${item.label}" data-alt="${altText}">${item.label}</span>`
                    : `<span class="sidebar-section-label">${item.label}</span>`;
                continue;
            }

            // HUB
            if (item.type === 'hub') {
                const isActive = item.children?.some(c => currentPath === c.href || (c.href !== '/' && currentPath.startsWith(c.href)));
                const badgeHtml = item.badge ? `<span class="nav-badge nav-badge--${item.badge.color}" data-badge-type="${item.badge.type}" style="display:none"></span>` : '';
                const childrenHtml = (item.children || []).map(c => {
                    const cBadge = c.badge ? `<span class="nav-badge nav-badge--${c.badge.color} nav-badge--sm" data-badge-type="${c.badge.type}" style="display:none"></span>` : '';
                    const cActive = currentPath === c.href || (c.href !== '/' && currentPath.startsWith(c.href));
                    return `<a href="${c.href}" class="nav-hub-child${cActive ? ' active' : ''}" data-page-access="${c.href}">
                        <span class="nav-hub-child-icon">${c.icon}</span>
                        <span class="nav-hub-child-label">${c.label}</span>${cBadge}
                    </a>`;
                }).join('');
                html += `<div class="nav-hub${isActive ? ' active hub-open' : ''}">
                    <div class="nav-hub-main">
                        <span class="nav-icon">${item.icon}</span>
                        <span class="nav-text">${item.label}</span>
                        ${badgeHtml}
                        <span class="nav-hub-arrow">›</span>
                    </div>
                    <div class="nav-hub-dropdown">${childrenHtml}</div>
                </div>`;
                continue;
            }

            // Regular link
            const isActive = currentPath === item.href ||
                (item.href === '/?settings=open' && window.location.search.includes('settings=open')) ||
                (item.href !== '/' && !item.href.startsWith('/?') && currentPath.startsWith(item.href));
            const actionAttr = item.action ? ` data-action="${item.action}" onclick="event.preventDefault(); if(typeof ${item.action}==='function') ${item.action}();"` : '';
            const badgeHtml = item.badge ? `<span class="nav-badge nav-badge--${item.badge.color}" data-badge-type="${item.badge.type}" style="display:none"></span>` : '';
            html += `<a href="${item.href}" class="nav-link${isActive ? ' active' : ''}" data-page-access="${item.href}"${actionAttr}>
                <span class="nav-icon">${item.icon}</span>
                <span class="nav-text">${item.label}</span>${badgeHtml}
            </a>`;
        }

        container.innerHTML = html;
        container.classList.add('rendered');

        // Animate section labels
        document.querySelectorAll('.sidebar-section-animated').forEach(el => {
            const main = el.dataset.label, alt = el.dataset.alt;
            if (!alt || alt === main) return;
            let showAlt = false;
            setInterval(() => {
                showAlt = !showAlt;
                el.style.opacity = '0';
                setTimeout(() => { el.textContent = showAlt ? alt : main; el.style.opacity = '1'; }, 200);
            }, 5000);
        });

        _initHubHover(container);
        _initCollapsedTooltips(container);
        _fetchLiveBadges();
    }

    // ═══ HUB HOVER ═══
    function _initHubHover(container) {
        container.querySelectorAll('.nav-hub').forEach(hub => {
            let closeTimer = null;
            const open = () => { clearTimeout(closeTimer); hub.classList.add('hub-open'); };
            const close = () => { closeTimer = setTimeout(() => hub.classList.remove('hub-open'), 200); };
            hub.addEventListener('mouseenter', open);
            hub.addEventListener('mouseleave', close);
            hub.querySelector('.nav-hub-main')?.addEventListener('click', (e) => {
                if (window.innerWidth <= 768 || document.getElementById('sidebarNav')?.classList.contains('collapsed')) {
                    e.preventDefault();
                    hub.classList.toggle('hub-open');
                }
            });
        });
    }

    // ═══ COLLAPSED TOOLTIPS ═══
    function _initCollapsedTooltips(container) {
        container.querySelectorAll('.nav-link, .nav-hub-main').forEach(el => {
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
        setTimeout(_fetchLiveBadges, 120000);
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
        _initDayContext(user.role);
    }

    async function _initDayContext(role) {
        const ctx = document.getElementById('sidebarDayContext');
        if (!ctx) return;
        const mgmt = ['creator','director','vice_director','senior_manager','manager','admin','accountant'];
        if (!mgmt.includes(role)) { ctx.style.display = 'none'; return; }
        ctx.classList.add('loading');
        try {
            const token = localStorage.getItem('pzp_token');
            const data = await fetch('/api/dashboard/alerts', { headers: { 'Authorization': 'Bearer ' + token } }).then(r => r.json()).catch(() => null);
            ctx.classList.remove('loading');
            if (!data || !data.count) { ctx.style.display = 'none'; return; }
            ctx.innerHTML = `<span class="sidebar-ctx-text">⚠️ ${data.count} сповіщень</span>`;
            ctx.style.display = 'block';
            ctx.style.cursor = 'pointer';
            ctx.onclick = () => { window.location.href = '/dashboard'; };
        } catch { ctx.classList.remove('loading'); ctx.style.display = 'none'; }
    }

    // ═══ FILTER ═══
    function _filterItems(items, role) {
        const tagged = items.map(item => {
            if (item.type === 'divider' || item.type === 'section') return { ...item, _visible: true };
            if (item.type === 'hub') return { ...item, _visible: _hasHubAccess(item, role) };
            return { ...item, _visible: !role || hasAccess(item, role) };
        });
        const withVisible = tagged.filter(item => item._visible);
        const result = [];
        for (let i = 0; i < withVisible.length; i++) {
            const item = withVisible[i];
            if (item.type === 'section') {
                let hasLinks = false;
                for (let j = i + 1; j < withVisible.length; j++) {
                    if (withVisible[j].type === 'divider' || withVisible[j].type === 'section') break;
                    if (!withVisible[j].type || withVisible[j].type === 'hub') { hasLinks = true; break; }
                }
                if (!hasLinks) continue;
            }
            if (item.type === 'divider') {
                let hasContent = false;
                for (let j = i + 1; j < withVisible.length; j++) {
                    if (!withVisible[j].type || withVisible[j].type === 'hub') { hasContent = true; break; }
                    if (withVisible[j].type === 'divider') break;
                }
                if (!hasContent) continue;
            }
            result.push(item);
        }
        while (result.length && result[0].type === 'divider') result.shift();
        return result;
    }

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
            overlay.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('active'); });
        }
        if (sidebar) {
            sidebar.addEventListener('click', (e) => {
                const link = e.target.closest('.nav-link, .nav-hub-child');
                if (!link) return;
                if (window.innerWidth <= 768 && overlay) { sidebar.classList.remove('open'); overlay.classList.remove('active'); }
            });
        }
        const collapseBtn = document.getElementById('sidebarCollapseBtn');
        if (collapseBtn && sidebar) {
            if (localStorage.getItem('pzp_sidebar_collapsed') === 'true') sidebar.classList.add('collapsed');
            collapseBtn.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
                localStorage.setItem('pzp_sidebar_collapsed', sidebar.classList.contains('collapsed'));
            });
        }
    }

    function checkPageAccess() {
        const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        if (typeof canAccessPage === 'function' && !canAccessPage(currentPath)) window.location.href = '/';
    }

    function init(containerSelector) {
        render(containerSelector);
        initToggle();
    }

    window.addEventListener('roleSwitched', () => {
        const container = document.querySelector('#sidebarLinks') || document.querySelector('#sidebarNav .sidebar-links');
        if (container) render('#' + container.id);
    });

    return { init, render, initToggle, checkPageAccess, initUserCard, NAV_ITEMS, SIDEBAR_ACCESS, hasAccess };
})();
