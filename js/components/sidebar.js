/**
 * js/components/sidebar.js — Unified sidebar navigation (v24.2.0)
 * Single source of truth for sidebar on ALL pages.
 * v24.2.0: Logical blocks, SIDEBAR_ACCESS matrix, section/divider support, smooth render
 */

const Sidebar = (() => {
    // ═══ NAV_ITEMS — 4 logical blocks ═══
    const NAV_ITEMS = [
        // BLOCK 1: Daily (all roles)
        { type: 'section', label: 'Щоденне' },
        { href: '/dashboard', icon: '🏠', label: 'Дашборд',          access: 'all' },
        { href: '/',          icon: '📅', label: 'Таймлайн івентів',  access: 'timeline' },
        { href: '/tasks',     icon: '✅', label: 'Задачі',            access: 'all' },
        { href: '/chat',      icon: '💬', label: 'Чат',               access: 'all' },
        { href: '/warehouse', icon: '📦', label: 'Склад',             access: 'all' },
        { href: '/training',  icon: '🎓', label: 'Навчання',          access: 'all' },

        // BLOCK 2: Management
        { type: 'divider' },
        { type: 'section', label: 'Управління' },
        { href: '/customers', icon: '👥', label: 'Клієнти',    access: 'management' },
        { href: '/sales-funnel', icon: '🔥', label: 'Ліди',     access: 'leads' },
        { href: '/copilot',   icon: '🤖', label: 'Менеджер',   access: 'copilot' },
        { href: '/staff',     icon: '📋', label: 'Команда',    access: 'staff' },
        { href: '/hr',        icon: '🤝', label: 'Кадри',      access: 'hr' },
        { href: '/finance',   icon: '💰', label: 'Фінанси',    access: 'finance' },
        { href: '/analytics', icon: '📊', label: 'Аналітика',  access: 'analytics' },
        { href: '/reports',   icon: '📋', label: 'Звіти',      access: 'reports' },

        // BLOCK 3: Product / Creative
        { type: 'divider' },
        { type: 'section', label: 'Продукт' },
        { href: '/programs',    icon: '🎪', label: 'Програми',    access: 'programs' },
        { href: '/center',      icon: '💲', label: 'Центр цін',   access: 'center' },
        { href: '/art',         icon: '🎨', label: 'Арт',         access: 'art' },

        // BLOCK 4: System
        { type: 'divider' },
        { type: 'section', label: 'Система' },
        { href: '/status',    icon: '🔦', label: 'Статус',        access: 'all' },
        { href: '/game',      icon: '🎮', label: 'Гра',           access: 'all' },
        { href: '/demo',      icon: '🎬', label: 'Demo',          access: 'demo' },
        { href: '/?settings=open', icon: '⚙️', label: 'Налаштування', access: 'settings' },
    ];

    // ═══ SIDEBAR_ACCESS matrix — role → visible pages ═══
    const ALL = true;

    const SIDEBAR_ACCESS = {
        all: ALL,

        timeline: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'admin',
            'senior_instructor', 'instructor',
            'hr',
            'accountant', 'it_specialist'
        ],

        management: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'admin',
            'marketer'
        ],

        leads: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'marketer'
        ],

        copilot: [
            'creator', 'director',
            'senior_manager', 'manager'
        ],

        staff: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'admin',
            'hr',
            'senior_instructor', 'instructor',
            'it_specialist'
        ],

        hr: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'hr'
        ],

        finance: [
            'creator', 'director', 'vice_director',
            'accountant',
            'senior_manager', 'manager'
        ],

        analytics: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'accountant', 'marketer',
            'it_specialist'
        ],

        reports: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'admin', 'accountant'
        ],

        programs: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'admin',
            'senior_instructor', 'instructor',
            'art_director'
        ],

        center: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'admin',
            'accountant'
        ],

        graduation: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'admin',
            'art_director', 'marketer'
        ],

        art: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'art_director', 'marketer'
        ],

        demo: [
            'creator', 'director', 'vice_director'
        ],

        settings: [
            'creator', 'director'
        ],

        // Графік в щоденному — хто бачить розклад персоналу щодня
        schedule_daily: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'admin',
            'senior_instructor', 'instructor',
            'hr', 'it_specialist'
        ],
    };

    // v20.6.0: Status badge config
    const STATUS_CONFIG = {
        building: { color: '#E53E3E', short: 'build' },
        testing:  { color: '#DD6B20', short: 'test' },
        updated:  { color: '#D69E2E', short: 'upd' },
        in_tests: { color: '#3182CE', short: 'live' },
        ready:    { color: '#38A169', short: '' }
    };

    let _pageStatuses = {};

    function hasAccess(item, role) {
        const access = SIDEBAR_ACCESS[item.access];
        if (access === true) return true;
        if (!access) return false;
        return access.includes(role);
    }

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
            const old = link.querySelector('.nav-status-badge, .nav-status-pill');
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

        // Filter items by role access, then clean up empty sections
        const filtered = _filterItems(NAV_ITEMS, role);

        let html = '';
        for (const item of filtered) {
            if (item.type === 'divider') {
                html += '<div class="sidebar-divider"></div>';
                continue;
            }
            if (item.type === 'section') {
                html += `<span class="sidebar-section-label">${item.label}</span>`;
                continue;
            }

            const isActive = currentPath === item.href ||
                (item.href === '/?settings=open' && window.location.search.includes('settings=open')) ||
                (item.href !== '/' && !item.href.startsWith('/?') && currentPath.startsWith(item.href));

            const actionAttr = item.action
                ? ` data-action="${item.action}" onclick="event.preventDefault(); if(typeof ${item.action}==='function') ${item.action}();"`
                : '';

            html += `<a href="${item.href}" class="nav-link${isActive ? ' active' : ''}" data-page-access="${item.href}"${actionAttr}>
                <span class="nav-icon">${item.icon}</span>
                <span class="nav-text">${item.label}</span>
            </a>`;
        }

        container.innerHTML = html;

        // Smooth render — prevent "jump" on page transitions
        container.classList.add('rendered');

        // Fetch and apply status badges
        fetchStatuses();
    }

    /**
     * Filter items by role, then remove empty sections (section header + divider with no links after them).
     */
    function _filterItems(items, role) {
        // Step 1: Mark nav items as visible/hidden
        const tagged = items.map(item => {
            if (item.type) return { ...item, _visible: true };
            return { ...item, _visible: !role || hasAccess(item, role) };
        });

        // Step 2: Remove hidden nav items
        const withVisible = tagged.filter(item => item._visible);

        // Step 3: Clean up empty sections
        // A section label is empty if there are no nav items before the next divider/section/end
        const result = [];
        for (let i = 0; i < withVisible.length; i++) {
            const item = withVisible[i];

            if (item.type === 'section') {
                // Look ahead: is there at least one nav item before next divider/section/end?
                let hasLinks = false;
                for (let j = i + 1; j < withVisible.length; j++) {
                    if (withVisible[j].type === 'divider' || withVisible[j].type === 'section') break;
                    if (!withVisible[j].type) { hasLinks = true; break; }
                }
                if (!hasLinks) continue; // skip empty section
            }

            if (item.type === 'divider') {
                // Look ahead: is there a section with links after this divider?
                let hasContent = false;
                for (let j = i + 1; j < withVisible.length; j++) {
                    if (!withVisible[j].type) { hasContent = true; break; }
                    if (withVisible[j].type === 'divider') break;
                }
                if (!hasContent) continue; // skip orphan divider
            }

            result.push(item);
        }

        // Remove leading dividers
        while (result.length && result[0].type === 'divider') result.shift();

        return result;
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

        // Close sidebar on mobile when clicking a nav link (prevents "stuck" tab)
        if (sidebar) {
            sidebar.addEventListener('click', (e) => {
                const link = e.target.closest('.nav-link');
                if (!link) return;
                // On mobile (<= 768px), close sidebar before navigation
                if (window.innerWidth <= 768 && overlay) {
                    sidebar.classList.remove('open');
                    overlay.classList.remove('active');
                }
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

    // Listen for role switch events — re-render sidebar with new role
    window.addEventListener('roleSwitched', () => {
        const container = document.querySelector('#sidebarLinks') || document.querySelector('#sidebarNav .sidebar-links');
        if (container) render('#' + container.id);
    });

    return { init, render, initToggle, checkPageAccess, NAV_ITEMS, SIDEBAR_ACCESS, hasAccess };
})();
