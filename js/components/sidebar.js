/**
 * js/components/sidebar.js — Unified sidebar navigation (v20.6.0)
 * Single source of truth for sidebar on ALL pages.
 * Determines active page from window.location.pathname.
 * Applies role-based visibility using PAGE_ACCESS from auth.js.
 * v20.6.0: Status badges (building/testing/updated/in_tests/ready)
 */

const Sidebar = (() => {
    // v21.15.0: Full NAV_ITEMS matching all standalone pages + PAGE_ACCESS
    const NAV_ITEMS = [
        { href: '/',          icon: 'Т',  label: 'Таймлайн' },
        { href: '/center',    icon: 'Ц',  label: 'Центр' },
        { href: '/tasks',     icon: 'З',  label: 'Задачі' },
        { href: '/chat',      icon: 'Чт', label: 'Чат' },
        { href: '/customers', icon: 'К',  label: 'Клієнти' },
        { href: '/programs',  icon: 'П',  label: 'Програми' },
        { href: '/staff',     icon: 'Ш',  label: 'Персонал' },
        { href: '/art',       icon: 'А',  label: 'Арт' },
        { href: '/designs',   icon: 'Д',  label: 'Дизайни' },
        { href: '/warehouse', icon: 'С',  label: 'Склад' },
        { href: '/training',  icon: 'Н',  label: 'Навчання' },
        { href: '/hr',        icon: 'HR', label: 'Кадри' },
        { href: '/finance',   icon: 'Ф',  label: 'Фінанси' },
        { href: '/analytics', icon: 'Ан', label: 'Аналітика' },
        { href: '/leads',     icon: 'Л',  label: 'Ліди' },
        { href: '/demo',      icon: 'De', label: 'Демо' },
        { href: '/status',    icon: 'Ст', label: 'Статус' },
        { href: '/settings',  icon: '⚙',  label: 'Налаштування' },
    ];

    // v20.6.0: Status badge config
    const STATUS_CONFIG = {
        building: { color: '#E53E3E', short: 'build' },
        testing:  { color: '#DD6B20', short: 'test' },
        updated:  { color: '#D69E2E', short: 'upd' },
        in_tests: { color: '#3182CE', short: 'live' },
        ready:    { color: '#38A169', short: '' }
    };

    let _pageStatuses = {};

    // Fetch page statuses from API (fire-and-forget, updates badges after load)
    async function fetchStatuses() {
        try {
            const token = localStorage.getItem('pzp_token');
            if (!token) return;
            const resp = await fetch('/api/page-statuses', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!resp.ok) return;
            const data = await resp.json();
            if (data.success && data.statuses) {
                _pageStatuses = data.statuses;
                applyBadges();
            }
        } catch { /* silent */ }
    }

    // Apply badges to already-rendered nav links
    function applyBadges() {
        document.querySelectorAll('.nav-link[data-page-access]').forEach(link => {
            const path = link.getAttribute('data-page-access');
            const status = _pageStatuses[path];
            // Remove existing badge
            const old = link.querySelector('.nav-status-badge');
            if (old) old.remove();

            if (!status || status === 'ready') return;
            const cfg = STATUS_CONFIG[status];
            if (!cfg) return;

            const badge = document.createElement('span');
            badge.className = 'nav-status-badge';
            badge.style.cssText = `background:${cfg.color}`;
            badge.title = status.replace('_', ' ');
            if (cfg.short && !link.closest('.collapsed')) {
                badge.textContent = cfg.short;
                badge.className = 'nav-status-pill';
                badge.style.cssText = `background:${cfg.color};color:#fff`;
            }
            link.appendChild(badge);
        });
    }

    function render(containerSelector) {
        const container = document.querySelector(containerSelector || '#sidebarNav .sidebar-links');
        if (!container) return;

        const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        const role = typeof getUserRole === 'function' ? getUserRole() : null;

        // Build page access map (from auth.js or fallback)
        const pageAccess = (typeof PAGE_ACCESS !== 'undefined') ? PAGE_ACCESS : {};

        let html = '';
        for (const item of NAV_ITEMS) {
            // Role-based visibility
            const allowed = pageAccess[item.href];
            if (allowed && role && !allowed.includes(role)) continue;

            const isActive = currentPath === item.href ||
                (item.href !== '/' && currentPath.startsWith(item.href));

            html += `<a href="${item.href}" class="nav-link${isActive ? ' active' : ''}" data-page-access="${item.href}">
                <span class="nav-icon">${item.icon}</span>
                <span class="nav-text">${item.label}</span>
            </a>`;
        }

        container.innerHTML = html;
        // Fetch and apply status badges
        fetchStatuses();
    }

    // Initialize sidebar toggle, overlay, collapse
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

        // Collapse button
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

    // Check page access — redirect to / if user has no access
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

    return { init, render, initToggle, checkPageAccess, NAV_ITEMS };
})();
