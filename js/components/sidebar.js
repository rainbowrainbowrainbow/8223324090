/**
 * js/components/sidebar.js — Unified sidebar navigation (v28.1.0)
 * Single source of truth for sidebar on ALL pages.
 * v28.1.0: Smart header quick tabs: Dashboard + most visited allowed tab + up to 2 pinned tabs
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
        { href: '/staff',     icon: '🗓️', label: 'Графік',            access: 'schedule_daily' },
        { href: '/warehouse', icon: '📦', label: 'Склад',             access: 'all' },
        { href: '/training',  icon: '🎓', label: 'Навчання',          access: 'all' },

        // BLOCK 2: Management
        { type: 'divider' },
        { type: 'section', label: 'Управління' },
        { href: '/customers', icon: '👥', label: 'Клієнти',    access: 'management' },
        { href: '/leads',     icon: '🔥', label: 'Ліди',       access: 'leads' },
        { href: '/copilot',   icon: '🤖', label: 'Менеджер',   access: 'copilot' },
        { href: '/staff',     icon: '📋', label: 'Команда',    access: 'staff' },
        { href: '/hr',        icon: '🤝', label: 'Кадри',      access: 'hr' },
        { href: '/finance',   icon: '💰', label: 'Фінанси',    access: 'finance' },
        { href: '/analytics', icon: '📊', label: 'Аналітика',  access: 'analytics' },

        // BLOCK 3: Product / Creative
        { type: 'divider' },
        { type: 'section', label: 'Продукт' },
        { href: '/programs',  icon: '🎪', label: 'Програми',    access: 'programs' },
        { href: '/center',    icon: '💲', label: 'Центр цін',   access: 'center' },
        { href: '/art',       icon: '🎨', label: 'Арт',         access: 'art' },

        // BLOCK 4: System
        { type: 'divider' },
        { type: 'section', label: 'Система' },
        { href: '/kleshnya',  icon: '🦞', label: 'Клешня',        access: 'all' },
        { href: '/status',    icon: '🔦', label: 'Статус',        access: 'all' },
        { href: '/game',      icon: '🎮', label: 'Гра',           access: 'all' },
        { href: '/demo',      icon: '🎬', label: 'Demo',          access: 'demo' },
        { href: '#settings',  icon: '⚙️', label: 'Налаштування', access: 'settings', action: 'showSettings' },
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
            'senior_manager',
            'hr'
        ],

        finance: [
            'creator', 'director', 'vice_director',
            'accountant',
            'senior_manager'
        ],

        analytics: [
            'creator', 'director', 'vice_director',
            'senior_manager', 'manager',
            'accountant', 'marketer',
            'it_specialist'
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

        art: [
            'creator', 'director', 'vice_director',
            'senior_manager',
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

    const QUICK_TABS_KEY = 'pzp_header_quick_tabs';
    const VISIT_COUNTS_KEY = 'pzp_nav_visit_counts';
    const QUICK_TABS_LIMIT = 2;
    const SUGGESTED_TABS_LIMIT = 1;

    let _pageStatuses = {};

    function hasAccess(item, role) {
        const access = SIDEBAR_ACCESS[item.access];
        if (access === true) return true;
        if (!access) return false;
        return access.includes(role);
    }

    function _normalizePath(path) {
        if (!path || path === '#settings') return path || '/';
        return path.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    }

    function _getCurrentPath() {
        return _normalizePath(window.location.pathname);
    }

    function _readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    }

    function _writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch { /* storage may be unavailable */ }
    }

    function _getAvailableNavItems(role) {
        return NAV_ITEMS.filter(item => !item.type && item.href !== '#settings' && (!role || hasAccess(item, role)));
    }

    function _getNavItemByHref(href, role) {
        const normalized = _normalizePath(href);
        return _getAvailableNavItems(role).find(item => _normalizePath(item.href) === normalized) || null;
    }

    function _getStoredQuickTabs(role) {
        const stored = _readJson(QUICK_TABS_KEY, []);
        const unique = [];

        if (!Array.isArray(stored)) return unique;

        for (const href of stored) {
            const normalized = _normalizePath(href);
            if (normalized === '/dashboard') continue;
            if (unique.includes(normalized)) continue;
            if (!_getNavItemByHref(normalized, role)) continue;
            unique.push(normalized);
            if (unique.length >= QUICK_TABS_LIMIT) break;
        }

        return unique;
    }

    function _getSuggestedQuickTabs(role, quickTabs) {
        const counts = _readJson(VISIT_COUNTS_KEY, {});
        const quickSet = new Set(quickTabs.map(_normalizePath));
        const candidates = _getAvailableNavItems(role)
            .filter(item => {
                const href = _normalizePath(item.href);
                return href !== '/dashboard' && !quickSet.has(href);
            });

        const visited = candidates
            .map(item => ({ item, count: Number(counts[_normalizePath(item.href)] || 0) }))
            .filter(({ count }) => count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, SUGGESTED_TABS_LIMIT)
            .map(({ item }) => _normalizePath(item.href));

        if (visited.length > 0) return visited;

        return candidates.slice(0, SUGGESTED_TABS_LIMIT).map(item => _normalizePath(item.href));
    }

    function _recordCurrentPageVisit() {
        const currentPath = _getCurrentPath();
        if (!currentPath || currentPath === '#settings') return;

        const currentItem = NAV_ITEMS.find(item => !item.type && _normalizePath(item.href) === currentPath);
        if (!currentItem) return;

        const counts = _readJson(VISIT_COUNTS_KEY, {});
        counts[currentPath] = Number(counts[currentPath] || 0) + 1;
        _writeJson(VISIT_COUNTS_KEY, counts);
    }

    function _renderHeaderLink(item, currentPath) {
        const href = _normalizePath(item.href);
        const isActive = currentPath === href || (href !== '/' && currentPath.startsWith(href));
        return `<a href="${item.href}" class="nav-link${isActive ? ' active' : ''}" data-page-access="${item.href}">
            <span class="nav-icon">${item.icon}</span> <span class="nav-text">${item.label}</span>
        </a>`;
    }

    function renderHeaderQuickTabs() {
        const container = document.querySelector('.header-nav');
        if (!container) return;

        const role = typeof getUserRole === 'function' ? getUserRole() : null;
        const currentPath = _getCurrentPath();
        const dashboard = _getNavItemByHref('/dashboard', role) || NAV_ITEMS.find(item => item.href === '/dashboard');
        const quickTabs = _getStoredQuickTabs(role);
        const suggestedTabs = _getSuggestedQuickTabs(role, quickTabs);

        const renderedHrefs = [];
        const htmlParts = [];

        [dashboard, ...suggestedTabs.map(href => _getNavItemByHref(href, role)), ...quickTabs.map(href => _getNavItemByHref(href, role))]
            .filter(Boolean)
            .forEach(item => {
                const href = _normalizePath(item.href);
                if (renderedHrefs.includes(href)) return;
                renderedHrefs.push(href);
                htmlParts.push(_renderHeaderLink(item, currentPath));
            });

        const hasMoreOptions = _getQuickTabOptions(role).length > 0;
        if (quickTabs.length < QUICK_TABS_LIMIT && hasMoreOptions) {
            htmlParts.push(`<a href="#quick-tabs" class="nav-link quick-tab-add" onclick="event.preventDefault(); Sidebar.openQuickTabsModal();" title="Додати вкладки">
                <span class="nav-icon">＋</span> <span class="nav-text">Додати</span>
            </a>`);
        }

        container.innerHTML = htmlParts.join('');
        applyBadges();
    }

    function _getQuickTabOptions(role) {
        return _getAvailableNavItems(role)
            .filter(item => _normalizePath(item.href) !== '/dashboard');
    }

    function openQuickTabsModal() {
        const role = typeof getUserRole === 'function' ? getUserRole() : null;
        const selected = new Set(_getStoredQuickTabs(role));
        const options = _getQuickTabOptions(role);

        const prev = document.getElementById('quickTabsOverlay');
        if (prev) prev.remove();

        const optionHtml = options.map(item => {
            const href = _normalizePath(item.href);
            return `<label class="quick-tabs-option">
                <input type="checkbox" value="${href}" ${selected.has(href) ? 'checked' : ''} onchange="Sidebar.enforceQuickTabsLimit(this)">
                <span class="quick-tabs-option-icon">${item.icon}</span>
                <span class="quick-tabs-option-label">${item.label}</span>
            </label>`;
        }).join('');

        const overlay = document.createElement('div');
        overlay.id = 'quickTabsOverlay';
        overlay.className = 'quick-tabs-overlay';
        overlay.innerHTML = `
            <style>
                .quick-tabs-overlay{position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px}
                .quick-tabs-modal{width:min(460px,100%);max-height:82vh;overflow:auto;background:var(--white,#fff);color:var(--gray-900,#111827);border-radius:18px;box-shadow:0 24px 80px rgba(15,23,42,.28);padding:24px}
                .dark-mode .quick-tabs-modal{background:var(--gray-900,#111827);color:var(--white,#fff)}
                .quick-tabs-modal h2{margin:0 0 8px;font-size:22px}
                .quick-tabs-modal p{margin:0 0 18px;color:var(--gray-500,#6b7280);font-size:14px}
                .quick-tabs-options{display:grid;gap:8px;margin-bottom:20px}
                .quick-tabs-option{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--gray-200,#e5e7eb);border-radius:12px;cursor:pointer}
                .dark-mode .quick-tabs-option{border-color:rgba(255,255,255,.14)}
                .quick-tabs-option-icon{width:24px;text-align:center}
                .quick-tabs-option-label{font-weight:600}
                .quick-tabs-actions{display:flex;justify-content:flex-end;gap:10px}
            </style>
            <div class="quick-tabs-modal" role="dialog" aria-modal="true" aria-label="Налаштування вкладок">
                <h2>Швидкі вкладки</h2>
                <p>Дашборд показується завжди. Автоматично додається 1 найчастіша вкладка, яка не вибрана вручну. Вручну можна додати ще 2.</p>
                <div class="quick-tabs-options">${optionHtml}</div>
                <div class="quick-tabs-actions">
                    <button class="dashboard-btn" type="button" onclick="document.getElementById('quickTabsOverlay').remove()">Скасувати</button>
                    <button class="dashboard-btn primary" type="button" onclick="Sidebar.saveQuickTabs()">Зберегти</button>
                </div>
            </div>
        `;

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);
    }

    function enforceQuickTabsLimit(checkbox) {
        if (!checkbox.checked) return;
        const checked = document.querySelectorAll('#quickTabsOverlay input[type="checkbox"]:checked');
        if (checked.length <= QUICK_TABS_LIMIT) return;
        checkbox.checked = false;
        if (typeof showNotification === 'function') {
            showNotification(`Можна додати максимум ${QUICK_TABS_LIMIT} вкладки`, 'warning');
        }
    }

    function saveQuickTabs() {
        const checked = Array.from(document.querySelectorAll('#quickTabsOverlay input[type="checkbox"]:checked'))
            .map(input => _normalizePath(input.value))
            .slice(0, QUICK_TABS_LIMIT);

        _writeJson(QUICK_TABS_KEY, checked);

        const overlay = document.getElementById('quickTabsOverlay');
        if (overlay) overlay.remove();

        renderHeaderQuickTabs();
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

        const currentPath = _getCurrentPath();
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
                (item.href !== '/' && item.href !== '#settings' && currentPath.startsWith(item.href));

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
        const currentPath = _getCurrentPath();
        if (typeof canAccessPage === 'function' && !canAccessPage(currentPath)) {
            window.location.href = '/';
        }
    }

    function init(containerSelector) {
        _recordCurrentPageVisit();
        render(containerSelector);
        renderHeaderQuickTabs();
        initToggle();
    }

    // Listen for role switch events — re-render sidebar with new role
    window.addEventListener('roleSwitched', () => {
        const container = document.querySelector('#sidebarLinks') || document.querySelector('#sidebarNav .sidebar-links');
        if (container) render('#' + container.id);
        renderHeaderQuickTabs();
    });

    return {
        init,
        render,
        renderHeaderQuickTabs,
        openQuickTabsModal,
        enforceQuickTabsLimit,
        saveQuickTabs,
        initToggle,
        checkPageAccess,
        NAV_ITEMS,
        SIDEBAR_ACCESS,
        hasAccess
    };
})();
