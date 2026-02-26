/**
 * js/components/sidebar.js — Unified sidebar navigation (v20.3.0)
 * Single source of truth for sidebar on ALL pages.
 * Determines active page from window.location.pathname.
 * Applies role-based visibility using PAGE_ACCESS from auth.js.
 */

const Sidebar = (() => {
    const NAV_ITEMS = [
        { href: '/',          icon: 'T',  label: 'Таймлайн' },
        { href: '/center',    icon: 'Ц',  label: 'Центр' },
        { href: '/tasks',     icon: 'З',  label: 'Задачі' },
        { href: '/art',       icon: 'А',  label: 'Арт' },
        { href: '/programs',  icon: 'П',  label: 'Програми' },
        { href: '/customers', icon: 'К',  label: 'Клієнти' },
        { href: '/staff',     icon: 'Ш',  label: 'Персонал' },
        { href: '/warehouse', icon: 'С',  label: 'Склад' },
        { href: '/designs',   icon: 'Д',  label: 'Дизайни' },
        { href: '/hr',        icon: 'H',  label: 'HR' },
        { href: '/training',  icon: 'Н',  label: 'Навчання' },
        { href: '/demo',      icon: 'Р',  label: 'Демо' },
        { href: '/settings',  icon: 'Л',  label: 'Налаштування' },
    ];

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
