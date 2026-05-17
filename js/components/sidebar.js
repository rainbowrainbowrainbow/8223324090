/**
 * js/components/sidebar.js — Sidebar Aurora v0.50.10
 * Living dual-theme sidebar with micro-interactions.
 */
const Sidebar = (() => {
    const _state = {
        transitionsBound: false,
        scrollRestored: false,
        userRetryStarted: false,
        badgeTimer: null,
        taskWidgetTimer: null,
        funnelWidgetTimer: null,
        roleRenderApplied: false
    };
    const GROUP_STATE_VERSION = 'ai-cockpit-v2';
    const COMMAND_DEFAULT_STATE = {
        tasksActive: 0,
        tasksOverdue: 0,
        alertsActive: 0,
        alertsUnread: 0,
        alertsCritical: 0,
        hotLeads: 0,
        newLeads: 0
    };
    const _commandState = { ...COMMAND_DEFAULT_STATE };

    // ═══ NAV_ITEMS ════════════════════════════════════════════════
    const NAV_ITEMS = [
        { type: 'group', key: 'today', label: 'Сьогодні', icon: '🏠', priority: 1, defaultOpen: true },
        { href: '/dashboard',    icon: '🏠', label: 'Дашборд',       access: 'all',            group: 'today' },
        { href: '/',             icon: '📅', label: 'Таймлайн',      access: 'timeline',       group: 'today' },
        { href: '/tasks',        icon: '✅', label: 'Задачі',        access: 'tasks',          group: 'today', statusKey: 'tasks' },
        { href: '/chat',         icon: '💬', label: 'Чат',           access: 'chat',           group: 'today', statusKey: 'chat' },

        { type: 'group', key: 'sales', label: 'Продажі', icon: '🔥', priority: 2, defaultOpen: true },
        { href: '/customers',    icon: '👥', label: 'Клієнти',       access: 'customers',      group: 'sales' },
        { href: '/sales-funnel', icon: '🔥', label: 'Ліди',          access: 'leads',          group: 'sales', statusKey: 'leads' },
        { href: '/omni',         icon: '✉', label: 'Комунікації',    access: 'omni',           group: 'sales', statusKey: 'omni' },
        { href: '/reports',      icon: '📋', label: 'Звіти',         access: 'reports',        group: 'sales' },
        { href: '/analytics',    icon: '📊', label: 'Аналітика',     access: 'analytics',      group: 'sales' },
        { href: '/finance',      icon: '💰', label: 'Фінанси',       access: 'finance',        group: 'sales' },
        { href: '/copilot',      icon: '🤖', label: 'AI менеджер',   access: 'copilot',        group: 'sales' },

        { type: 'group', key: 'team', label: 'Команда', icon: '🤝', priority: 3, defaultOpen: false },
        { href: '/staff',        icon: '🗓️', label: 'Графік',        access: 'schedule_daily', group: 'team', staffView: 'schedule' },
        { href: '/hr',           icon: '🤝', label: 'Кадри',         access: 'hr_page',        group: 'team' },
        { href: '/hr#team',      icon: '📋', label: 'Команда HR',    access: 'hr_page',        group: 'team' },
        { href: '/training',     icon: '🎓', label: 'Навчання',      access: 'training',       group: 'team' },
        { href: '/checkin',      icon: '📸', label: 'Check-in',      access: 'hr_page',        group: 'team' },

        { type: 'group', key: 'product', label: 'Продукт', icon: '🎨', priority: 4, defaultOpen: false },
        { href: '/programs',     icon: '🎪', label: 'Програми',      access: 'programs',       group: 'product' },
        { href: '/content',      icon: '📱', label: 'Контент',       access: 'content',        group: 'product' },
        { href: '/art',          icon: '🎨', label: 'Арт директор',  access: 'art',            group: 'product' },
        { href: '/graduation',   icon: '🎓', label: 'Випускний',     access: 'graduation',     group: 'product' },
        { href: '/designs',      icon: '🖼️', label: 'Дизайн-борд',   access: 'art',            group: 'product' },
        { href: '/designs#catalogs', icon: '📂', label: 'Каталоги',  access: 'art',            group: 'product' },
        { href: '/designer',     icon: '📖', label: 'Стайлгайд',     access: 'art',            group: 'product' },
        { href: '/sound#projects',      icon: '🎬', label: 'Звук',   access: 'sound',          group: 'product' },
        { href: '/sound#library',       icon: '🎵', label: 'Бібліотека звуку', access: 'sound', group: 'product' },
        { href: '/sound#announcements', icon: '📢', label: 'Оголошення', access: 'sound',      group: 'product' },
        { href: '#afisha',       icon: '🎭', label: 'Афіша',         access: 'afisha',         group: 'product',
          action: 'sidebarOpenAfisha',       isHashLink: true },
        { href: '#certificates', icon: '🎫', label: 'Сертифікати',   access: 'certificates',   group: 'product',
          action: 'sidebarOpenCertificates', isHashLink: true },

        { type: 'group', key: 'system', label: 'Система', icon: '⚙️', priority: 5, defaultOpen: false },
        { href: '/kleshnya',     icon: '🤖', label: 'Клешня',        access: 'chat',           group: 'system' },
        { href: '/guardian-ops', icon: '🛡️', label: 'Guardian Ops',  access: 'guardian_ops',   group: 'system' },
        { href: '/center',       icon: '🎛️', label: 'Центр керування', access: 'center',       group: 'system' },
        { href: '/warehouse',    icon: '📦', label: 'Склад',         access: 'warehouse',      group: 'system' },
        { href: '/game',         icon: '🎮', label: 'Гра',           access: 'all',            group: 'system' },
        { href: '/demo',         icon: '🎬', label: 'Demo',          access: 'demo',           group: 'system' },
        { href: '#settings',     icon: '⚙️', label: 'Налаштування',  access: 'settings',       group: 'system',
          action: 'sidebarOpenSettings', isHashLink: true },
    ];

    // ═══ ACCESS MATRIX ════════════════════════════════════════════
    const ALL = true;
    // v39.10: Sidebar access aligned with PAGE_ACCESS + security/reception roles added
    const _ROLE_HIERARCHY = ['waiter','dishwasher','maintenance','cleaning','wardrobe','barista','security','reception','animator','pastry_chef','head_pastry','cook','head_chef','instructor','senior_instructor','admin','hr','it_specialist','marketer','art_director','accountant','manager','senior_manager','vice_director','director','creator'];
    const _ALL_STAFF = _ROLE_HIERARCHY.filter(r => r !== 'waiter');
    const _MGR_UP = ['creator','director','vice_director','senior_manager','manager'];
    const _ADMIN_UP = [..._MGR_UP, 'admin', 'hr', 'accountant', 'art_director', 'marketer', 'it_specialist'];
    const SIDEBAR_ACCESS = {
        all:            ALL,
        tasks:          _ALL_STAFF,
        chat:           _ALL_STAFF,
        timeline:       [..._ADMIN_UP, 'reception', 'senior_instructor', 'instructor', 'security'],
        management:     [..._MGR_UP, 'admin', 'marketer'],
        leads:          [..._MGR_UP, 'marketer'],
        omni:           _MGR_UP,
        copilot:        _MGR_UP,
        staff:          [..._MGR_UP, 'admin', 'hr', 'senior_instructor', 'instructor', 'it_specialist', 'security'],
        hr:             [..._MGR_UP, 'hr', 'admin', 'security'],
        hr_page:        [..._MGR_UP, 'hr', 'admin', 'security'],
        finance:        ['creator','director','accountant'],
        analytics:      _MGR_UP,
        reports:        ['creator','director','vice_director','senior_manager','accountant'],
        programs:       [..._MGR_UP, 'admin', 'senior_instructor', 'instructor', 'art_director'],
        center:         _MGR_UP,
        graduation:     [..._MGR_UP, 'admin', 'art_director', 'marketer'],
        art:            [..._MGR_UP, 'art_director', 'marketer'],
        content:        [..._MGR_UP, 'art_director', 'marketer'],
        sound:          [..._MGR_UP, 'art_director'],
        afisha:         _ALL_STAFF,
        certificates:   _ALL_STAFF,
        demo:           _MGR_UP,
        settings:       ['creator','director'],
        guardian_ops:   ['creator','director','admin','security'],
        schedule_daily: [..._MGR_UP, 'admin', 'hr', 'senior_instructor', 'instructor', 'it_specialist', 'security'],
        customers:      [..._ADMIN_UP, 'reception'],
        warehouse:      [..._MGR_UP, 'admin'],
        training:       [..._MGR_UP, 'hr', 'senior_instructor', 'instructor'],
    };

    const ICON_ALIASES = {
        '📋': 'crm',
        '🏠': 'dashboard',
        '📅': 'calendar',
        '✅': 'task',
        '💬': 'chat',
        '📦': 'warehouse',
        '🎛️': 'center',
        '👔': 'management',
        '👥': 'users',
        '🔥': 'funnel',
        '✉': 'mail',
        '💰': 'finance',
        '📊': 'analytics',
        '🤖': 'ai',
        '🤝': 'hr',
        '🗓️': 'timeline',
        '🎓': 'training',
        '📸': 'camera',
        '🎨': 'art',
        '📱': 'content',
        '🎪': 'programs',
        '🎭': 'afisha',
        '🎫': 'ticket',
        '📐': 'designer',
        '🖼️': 'image',
        '📂': 'folder',
        '📖': 'book',
        '🔊': 'sound',
        '🎵': 'music',
        '📢': 'megaphone',
        '🎬': 'project',
        '⚙️': 'system',
        '🦞': 'ai',
        '🛡️': 'guardian',
        '🎮': 'game',
        '⚠️': 'alert',
        '☀️': 'sun',
        '🌙': 'moon',
        task: 'task',
        alert: 'alert',
        funnel: 'funnel',
        calendar: 'calendar',
        timeline: 'timeline',
        chat: 'chat',
        sun: 'sun',
        moon: 'moon'
    };

    const ICON_DRAWINGS = {
        crm: '<path d="M9 3h6l1 2h2v16H6V5h2z"/><path d="M8 5h8M9 10h6M9 14h5M9 18h4"/>',
        dashboard: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h5v-6h2v6h5V10"/>',
        calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16M8 14h2M12 14h2M16 14h2"/>',
        timeline: '<path d="M5 7h14M5 17h14"/><circle cx="8" cy="7" r="2"/><circle cx="16" cy="17" r="2"/><path d="M10 7c4 0 0 10 4 10"/>',
        task: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 12l3 3 5-6"/>',
        chat: '<path d="M5 6h14v9H9l-4 4z"/><path d="M8 10h8M8 13h5"/>',
        warehouse: '<path d="M4 9l8-5 8 5-8 5z"/><path d="M4 9v8l8 5 8-5V9"/><path d="M12 14v8"/>',
        center: '<path d="M5 7h14M5 12h14M5 17h14"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="17" r="2"/>',
        management: '<path d="M8 6h8l-2 4h-4z"/><path d="M9 10l-2 10h10l-2-10"/><path d="M12 10v10"/>',
        users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c1-4 4-6 6-6s5 2 6 6"/><circle cx="17" cy="9" r="2"/><path d="M15 15c2 0 4 2 5 5"/>',
        funnel: '<path d="M4 5h16l-6 7v5l-4 2v-7z"/>',
        mail: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 8l8 6 8-6"/>',
        finance: '<path d="M5 8h14v10H5z"/><path d="M7 8V6h10v2"/><circle cx="12" cy="13" r="2"/>',
        analytics: '<path d="M5 19V5"/><path d="M5 19h14"/><path d="M8 16v-5M12 16V8M16 16v-8"/>',
        ai: '<rect x="6" y="7" width="12" height="10" rx="3"/><path d="M9 7V4M15 7V4M9 12h.01M15 12h.01M10 16h4"/><path d="M4 12h2M18 12h2"/>',
        hr: '<path d="M7 18c1-3 3-5 5-5s4 2 5 5"/><circle cx="12" cy="8" r="3"/><path d="M5 11l2 2M19 11l-2 2"/>',
        training: '<path d="M4 8l8-4 8 4-8 4z"/><path d="M8 11v4c2 2 6 2 8 0v-4"/><path d="M20 8v5"/>',
        camera: '<path d="M6 8h3l1.5-2h3L15 8h3v10H6z"/><circle cx="12" cy="13" r="3"/>',
        art: '<path d="M7 17c3 2 9 1 11-3 2-5-2-9-7-8-4 1-7 5-6 9 0 1 1 2 2 2z"/><circle cx="9" cy="10" r=".8"/><circle cx="12" cy="8" r=".8"/><circle cx="15" cy="10" r=".8"/>',
        content: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M11 18h2M10 6h4"/>',
        programs: '<path d="M5 19h14L16 7l-4-3-4 3z"/><path d="M8 11h8M9 15h6"/>',
        afisha: '<path d="M7 5h10v14H7z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
        ticket: '<path d="M5 8h14v8H5z"/><path d="M8 8c0 2-1 2-3 2M8 16c0-2-1-2-3-2M16 8c0 2 1 2 3 2M16 16c0-2 1-2 3-2M12 8v8"/>',
        designer: '<path d="M5 19l14-14"/><path d="M7 17h5v2H5v-7h2z"/><path d="M15 5l4 4"/>',
        image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M6 17l4-4 3 3 2-2 3 3"/>',
        folder: '<path d="M4 7h6l2 2h8v9H4z"/>',
        book: '<path d="M5 5h7v15H5zM12 5h7v15h-7"/><path d="M8 9h2M15 9h2"/>',
        sound: '<path d="M5 10h4l5-4v12l-5-4H5z"/><path d="M17 9c1 2 1 4 0 6M19 7c2 3 2 7 0 10"/>',
        music: '<path d="M9 18a2 2 0 1 1-2-2"/><path d="M17 16a2 2 0 1 1-2-2"/><path d="M9 16V6l8-2v10"/>',
        megaphone: '<path d="M4 13h3l9 4V7l-9 4H4z"/><path d="M7 13l2 6"/>',
        project: '<path d="M5 6h14v12H5z"/><path d="M5 10h14M8 6l3 4M14 6l3 4"/>',
        system: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
        guardian: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-5"/>',
        game: '<rect x="5" y="9" width="14" height="8" rx="4"/><path d="M8 13h4M10 11v4M16 12h.01M18 14h.01"/>',
        alert: '<path d="M12 4l9 16H3z"/><path d="M12 9v5M12 17h.01"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
        moon: '<path d="M17 3a8 8 0 1 0 4 12 7 7 0 0 1-4-12z"/>'
    };

    function _iconKey(icon) {
        const raw = String(icon || 'crm');
        return ICON_ALIASES[raw] || raw;
    }

    function _renderIcon(icon, className = 'nav-icon') {
        const key = _iconKey(icon);
        const safeKey = ICON_DRAWINGS[key] ? key : 'crm';
        return `<span class="${className} eg-icon eg-icon--${safeKey}" aria-hidden="true"><span class="nav-icon-magnet"><svg class="eg-icon-svg" viewBox="0 0 24 24" focusable="false">${ICON_DRAWINGS[safeKey]}</svg></span></span>`;
    }

    function _renderStatusIcon(type) {
        const drawings = {
            tasks: '<rect x="6.2" y="6.2" width="11.6" height="11.6" rx="3.1"/><path d="M9.2 12.2l2 2 4-4.5"/><path d="M8.6 4.4h6.8"/><path d="M8.6 19.6h6.8"/>',
            alerts: '<path d="M8.1 10.4a3.9 3.9 0 0 1 7.8 0c0 3 1.3 4.1 2.1 5H6c.8-.9 2.1-2 2.1-5z"/><path d="M10.5 17.5a1.7 1.7 0 0 0 3 0"/><path d="M12 4.2v1.4"/><path d="M5.4 7.1l1.2 1.1M18.6 7.1l-1.2 1.1"/>',
            funnel: '<path d="M6.4 6.7h11.2l-4.2 5.2v3.3l-2.8 1.4v-4.7z"/><circle cx="8" cy="6.7" r="1.1"/><circle cx="16" cy="6.7" r="1.1"/><circle cx="12" cy="17.5" r="1.1"/><path d="M8 19.7h8"/>'
        };
        const safe = drawings[type] ? type : 'tasks';
        return `<svg class="sidebar-status-svg sidebar-status-svg--${safe}" viewBox="0 0 24 24" focusable="false" aria-hidden="true">${drawings[safe]}</svg>`;
    }

    function _renderGroupChevron() {
        return `
    <span class="sidebar-group-chevron" aria-hidden="true">
      <svg class="sidebar-group-chevron-svg" viewBox="0 0 20 20" focusable="false">
        <path d="M6 8l4 4 4-4"></path>
      </svg>
    </span>`;
    }

    // ═══ ACCORDION STATE ══════════════════════════════════════════
    function _getGroupState() {
        try {
            const parsed = JSON.parse(localStorage.getItem('pzp_sidebar_groups') || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
            return parsed;
        }
        catch { return {}; }
    }
    function _ensureCollapsedGroupsBaseline() {
        try {
            if (localStorage.getItem('pzp_sidebar_group_state_version') === GROUP_STATE_VERSION) return;
            localStorage.setItem('pzp_sidebar_groups', '{}');
            localStorage.setItem('pzp_sidebar_group_state_version', GROUP_STATE_VERSION);
        } catch {}
    }

    function getRolePreferredGroups(role) {
        const map = {
            creator: ['today', 'sales'],
            director: ['today', 'sales'],
            vice_director: ['today', 'sales'],
            manager: ['today', 'sales'],
            senior_manager: ['today', 'sales'],
            admin: ['today', 'team'],
            hr: ['team'],
            accountant: ['sales'],
            marketer: ['sales', 'product'],
            art_director: ['product'],
            instructor: ['today', 'team'],
            senior_instructor: ['today', 'team'],
            security: ['today', 'system'],
            reception: ['today', 'sales'],
            it_specialist: ['today', 'system']
        };
        return map[String(role || '').trim()] || ['today'];
    }

    function _saveGroupStateFromDom(sidebar) {
        const root = sidebar || document.getElementById('sidebarNav');
        if (!root) return;
        const next = {};
        root.querySelectorAll('.sidebar-group[data-group-key]').forEach((group) => {
            const key = group.dataset.groupKey;
            const items = group.querySelector('.sidebar-group-items');
            if (!key || !items) return;
            next[key] = items.classList.contains('open');
        });
        localStorage.setItem('pzp_sidebar_groups', JSON.stringify(next));
    }
    function _isGroupOpen(key, defaultOpen, role, hasActive = false) {
        const s = _getGroupState();
        if (key in s) return s[key];
        if (hasActive) return true;
        const preferred = getRolePreferredGroups(role);
        if (preferred.includes(key)) return true;
        return !!defaultOpen && preferred.length === 0;
    }

    // Get the first hash for a given base path (e.g. '/sound' → 'library')
    function _getDefaultHash(basePath) {
        const first = NAV_ITEMS.find(i => i.href && i.href.includes('#') && i.href.split('#')[0] === basePath);
        return first ? first.href.split('#')[1] : '';
    }

    // ═══ RENDER ═══════════════════════════════════════════════════
    function render(containerSelector) {
        const container = document.querySelector(containerSelector || '#sidebarNav .sidebar-links');
        if (!container) return;
        const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        const savedUser = _getCurrentSidebarUser();
        const role = _getSidebarPrimaryRole(savedUser) || (typeof getUserRole === 'function' ? getUserRole() : null) || null;

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

                // Mark group that contains the current page without forcing it open.
                const hasActive = NAV_ITEMS.some(c => {
                    if (c.group !== item.key || c.noActive || c.isHashLink) return false;
                    const cBase = c.href.split('#')[0];
                    return currentPath === cBase || (cBase !== '/' && currentPath.startsWith(cBase));
                });
                const finalOpen = _isGroupOpen(item.key, item.defaultOpen, role, hasActive);

                html += `
<div class="sidebar-group${hasActive ? ' has-active' : ''}" data-group-key="${item.key}">
  <button class="sidebar-group-header${finalOpen ? ' open' : ''}${hasActive ? ' has-active' : ''}"
          onclick="Sidebar.toggleGroup('${item.key}', this)"
          title="${item.label}">
    ${_renderIcon(item.icon)}
    <span class="nav-text sidebar-group-label">${item.label}</span>
    <span class="sidebar-group-signal" id="sidebarGroupSignal-${item.key}" aria-hidden="true"></span>
    ${_renderGroupChevron()}
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
            const itemBase = item.href.split('#')[0];
            const itemHash = item.href.includes('#') ? item.href.split('#')[1] : '';
            const currentHash = location.hash.replace('#', '');
            // v38.9.0: Simple active logic — exact match only
            // Hash items: active only when URL hash matches exactly
            // Non-hash items: active only when URL matches AND no hash in URL
            let isActive = false;
            if (item.noActive || item.isHashLink) {
                isActive = false;
            } else if (itemHash) {
                // Hash item: active when URL hash matches exactly
                if (currentPath === itemBase) {
                    if (currentHash) {
                        isActive = currentHash === itemHash;
                    } else {
                        // No hash in URL — default first hash item ONLY if no non-hash item exists for same base
                        const hasNonHashItem = NAV_ITEMS.some(n => !n.type && n.href === itemBase);
                        if (!hasNonHashItem) {
                            const firstHash = NAV_ITEMS.find(n => !n.type && n.href?.startsWith(itemBase + '#'));
                            isActive = firstHash?.href === item.href;
                        }
                        // If non-hash item exists (/designs), hash items stay inactive when no hash
                    }
                }
            } else {
                // Non-hash item (e.g. /designs): active when path matches AND no hash
                isActive = currentPath === item.href && !currentHash;
            }

            // E9 FIX: simplified onclick
            let onclickAttr = '';
            if (item.action) {
                onclickAttr = ` onclick="event.preventDefault();if(typeof ${item.action}==='function')${item.action}();"`;
            }

            const badgeType = _badgeTypeFor(item);
            const badgeClass = badgeType === 'alerts' ? ' nav-badge alert' : ' nav-badge';

            const statusText = _navStatusFor(item);
            html += `<a href="${item.href}" class="nav-link${isActive ? ' active' : ''}" data-page-access="${item.href}"${onclickAttr}>
  ${_renderIcon(item.icon)}
  <span class="nav-copy">
    <span class="nav-text">${item.label}</span>
    ${item.statusKey ? `<span class="nav-status" data-sidebar-status-key="${item.statusKey}"${statusText ? '' : ' hidden'}>${statusText || ''}</span>` : ''}
  </span>
  ${badgeType ? `<span class="${badgeClass.trim()}" data-badge-type="${badgeType}" style="display:none"></span>` : ''}
</a>`;
        }

        // Close last group
        if (currentGroupKey && currentGroupKey !== '__skip__') {
            html += '</div></div></div>';
        }

        container.innerHTML = html;
        container.classList.add('rendered');

        _ensureAuroraLayer();
        _ensureCommandDeck();
        _syncGroupSignals();
        _ensureActiveIndicator();
        _initCollapsedTooltips(container);
        _initSpotlight();
        _initRipple();
        _initMagnetic();
        _fetchLiveBadges();
        _refreshTaskMiniWidget();
        _refreshFunnelWidget();
        _queueActiveIndicatorUpdate();
    }

    function _markShellReady() {
        document.body.classList.remove('shell-baseline', 'page-exiting');
        document.body.classList.add('shell-ready');
        document.body.removeAttribute('aria-busy');
        document.documentElement.classList.add('shell-ready');
    }

    function _clearShellReady() {
        document.body.classList.remove('shell-ready');
        document.documentElement.classList.remove('shell-ready');
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
        _saveGroupStateFromDom(document.getElementById('sidebarNav'));
        _queueActiveIndicatorUpdate();
    }

    // ═══ ACCESS CHECK ══════════════════════════════════════════════
    function hasAccess(item, role) {
        // v39.10: Creator always sees everything
        if (role === 'creator') return true;
        const access = SIDEBAR_ACCESS[item.access];
        if (access === true) return true;
        if (!access) return false;
        return access.includes(role);
    }

    function _badgeTypeFor(item) {
        const href = String(item?.href || '');
        if (href === '/chat') return 'unread';
        if (href === '/sales-funnel') return 'leads_new';
        return '';
    }

    function _navStatusFor(item) {
        switch (item?.statusKey) {
            case 'tasks':
                if (_commandState.tasksOverdue > 0) return `${_formatSignalCount(_commandState.tasksOverdue)} простр.`;
                if (_commandState.tasksActive > 0) return `${_formatSignalCount(_commandState.tasksActive)} актив.`;
                return '';
            case 'leads':
                if (_commandState.hotLeads > 0) return `${_formatSignalCount(_commandState.hotLeads)} гарячих`;
                if (_commandState.newLeads > 0) return `${_formatSignalCount(_commandState.newLeads)} нових`;
                return '';
            case 'chat': {
                const unread = typeof ChatState !== 'undefined' ? Number(ChatState.totalUnread || 0) : 0;
                return unread > 0 ? `${_formatSignalCount(unread)} нових` : '';
            }
            case 'omni':
                return _commandState.alertsCritical > 0 ? 'є ризики' : '';
            default:
                return '';
        }
    }

    function _syncNavStatusLabels() {
        document.querySelectorAll('[data-sidebar-status-key]').forEach((el) => {
            const key = el.dataset.sidebarStatusKey;
            const text = _navStatusFor({ statusKey: key });
            el.textContent = text;
            el.hidden = !text;
        });
    }

    const GROUP_SIGNAL_SOURCES = {};

    const SIGNAL_RANK = { idle: 0, live: 1, hot: 2, critical: 3 };

    function _formatSignalCount(value) {
        const count = Number(value || 0);
        if (!Number.isFinite(count) || count <= 0) return '';
        return count > 99 ? '99+' : String(Math.floor(count));
    }

    function _syncGroupSignals() {
        const sidebar = document.getElementById('sidebarNav');
        if (!sidebar) return;
        Object.entries(GROUP_SIGNAL_SOURCES).forEach(([groupKey, ids]) => {
            let total = 0;
            let topSeverity = 'idle';
            ids.forEach((id) => {
                const el = document.getElementById(id);
                if (!el || el.hidden) return;
                const count = Number(el.dataset.sidebarCount || 0);
                if (Number.isFinite(count) && count > 0) total += count;
                const severity = el.dataset.sidebarSeverity || 'idle';
                if ((SIGNAL_RANK[severity] || 0) > (SIGNAL_RANK[topSeverity] || 0)) topSeverity = severity;
            });
            const group = sidebar.querySelector(`.sidebar-group[data-group-key="${groupKey}"]`);
            const header = group?.querySelector('.sidebar-group-header');
            const signal = group?.querySelector('.sidebar-group-signal');
            if (!group || !header || !signal) return;
            const hasSignal = total > 0;
            signal.textContent = _formatSignalCount(total);
            signal.classList.toggle('is-visible', hasSignal);
            signal.setAttribute('aria-hidden', hasSignal ? 'false' : 'true');
            signal.classList.toggle('is-critical', topSeverity === 'critical');
            signal.classList.toggle('is-hot', topSeverity === 'hot');
            group.classList.toggle('has-signal', hasSignal);
            header.classList.toggle('has-signal', hasSignal);
            header.classList.toggle('signal-critical', topSeverity === 'critical');
            header.classList.toggle('signal-hot', topSeverity === 'hot');
        });
    }

    function _queueActiveIndicatorUpdate() {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_updateActiveIndicator);
        else setTimeout(_updateActiveIndicator, 0);
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
        if (_state.badgeTimer) {
            clearTimeout(_state.badgeTimer);
            _state.badgeTimer = null;
        }
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
            if (alertsR.status === 'fulfilled') _renderSidebarAlerts(alertsR.value);
            _setBadge('leads_new', leadsNew > 0 ? leadsNew : null);
        } catch {}
        const chatUnread = typeof ChatState !== 'undefined' ? (ChatState.totalUnread || 0) : 0;
        _setBadge('unread', chatUnread > 0 ? chatUnread : null);
        _syncNavStatusLabels();
        _state.badgeTimer = setTimeout(_fetchLiveBadges, 300000);
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

    // ═══ AURORA SHELL ═══
    function _ensureAuroraLayer() {
        const sidebar = document.getElementById('sidebarNav');
        if (!sidebar || sidebar.querySelector('.sidebar-aurora')) return;
        const aurora = document.createElement('div');
        aurora.className = 'sidebar-aurora';
        aurora.innerHTML = '<div class="sidebar-aurora-blob-1"></div><div class="sidebar-aurora-blob-2"></div>';
        sidebar.insertBefore(aurora, sidebar.firstChild);
    }

    function _sidebarRoleLabel(role) {
        const labels = {
            creator: 'Creator',
            director: 'Директор',
            vice_director: 'Заст. директора',
            senior_manager: 'Ст. менеджер',
            manager: 'Менеджер',
            admin: 'Адмін',
            hr: 'HR',
            hr_manager: 'HR менеджер',
            accountant: 'Бухгалтер',
            animator: 'Аніматор',
            instructor: 'Інструктор',
            trampoline_instructor: 'Інструктор батутів',
            waiter: 'Офіціант',
            bartender: 'Бармен',
            cook: 'Кухар',
            head_cook: 'Шеф-кухар',
            art_director: 'Арт директор',
            designer: 'Дизайнер',
            sound: 'Звук',
            warehouse: 'Склад'
        };
        const key = String(role || '').trim();
        return labels[key] || key;
    }

    function _sidebarRoleLine(user) {
        if (!user) return 'Гість';
        const rawRoles = Array.isArray(user.roles) && user.roles.length
            ? user.roles
            : [user.role || user.account_role || user.accountRole].filter(Boolean);
        const roles = rawRoles
            .map(_sidebarRoleLabel)
            .filter(Boolean)
            .filter((role, index, list) => list.indexOf(role) === index);
        return roles.length ? roles.slice(0, 3).join(' · ') : 'Користувач CRM';
    }

    function _ensureCommandDeck() {
        const sidebar = document.getElementById('sidebarNav');
        if (!sidebar) return;
        sidebar.querySelector('.sidebar-pills')?.remove();
        sidebar.querySelector('.sidebar-dashboard-jump-wrap')?.remove();

        const links = sidebar.querySelector('.sidebar-links');
        if (!links) return;

        let deck = document.getElementById('sidebarCommandDeck');
        if (!deck) {
            deck = document.createElement('div');
            deck.id = 'sidebarCommandDeck';
            deck.className = 'sidebar-command-deck';
            deck.innerHTML = `
                <span class="sidebar-command-kicker">Клешня · операційний стан</span>
                <button class="sidebar-identity-card" id="sidebarIdentityCard" type="button" aria-label="Відкрити профіль">
                    <span class="sidebar-identity-avatar" id="sidebarIdentityAvatar">?</span>
                    <span class="sidebar-identity-main">
                        <span class="sidebar-identity-title-row">
                            <span class="sidebar-identity-name" id="sidebarIdentityName">Event Genix</span>
                            <span class="sidebar-identity-role" id="sidebarIdentityRole">CRM</span>
                        </span>
                        <span class="sidebar-identity-summary" id="sidebarIdentitySummary">Операційний стан завантажується...</span>
                    </span>
                    <span class="sidebar-identity-chevron" aria-hidden="true">›</span>
                </button>

                <div class="sidebar-focus-deck" id="sidebarFocusDeck" aria-label="Операційний фокус">
                    <a href="/tasks?view=my" class="focus-chip focus-chip--tasks" id="focusChipTasks" aria-label="Мої задачі">
                        <span class="focus-chip-icon">${_renderStatusIcon('tasks')}</span>
                        <span class="focus-chip-value" id="focusChipTasksValue">0</span>
                        <span class="focus-chip-label">Задачі</span>
                        <span class="focus-chip-meta" id="focusChipTasksMeta">спокійно</span>
                    </a>
                    <button type="button" class="focus-chip focus-chip--alerts" id="focusChipAlerts" aria-label="Алерти">
                        <span class="focus-chip-icon">${_renderStatusIcon('alerts')}</span>
                        <span class="focus-chip-value" id="focusChipAlertsValue">0</span>
                        <span class="focus-chip-label">Алерти</span>
                        <span class="focus-chip-meta" id="focusChipAlertsMeta">спокійно</span>
                    </button>
                    <a href="/sales-funnel" class="focus-chip focus-chip--funnel" id="focusChipFunnel" aria-label="Ліди">
                        <span class="focus-chip-icon">${_renderStatusIcon('funnel')}</span>
                        <span class="focus-chip-value" id="focusChipFunnelValue">0</span>
                        <span class="focus-chip-label">Ліди</span>
                        <span class="focus-chip-meta" id="focusChipFunnelMeta">без нових</span>
                    </a>
                </div>

                <button type="button" class="sidebar-primary-action" id="sidebarPrimaryAction">
                    <span class="sidebar-primary-action-kicker">AI фокус</span>
                    <span class="sidebar-primary-action-label">Відкрити центр керування</span>
                </button>`;
            sidebar.insertBefore(deck, links);
        } else if (deck.nextElementSibling !== links) {
            sidebar.insertBefore(deck, links);
        }

        const alertsChip = document.getElementById('focusChipAlerts');
        if (alertsChip && alertsChip.dataset.alertsBound !== 'true') {
            alertsChip.dataset.alertsBound = 'true';
            alertsChip.addEventListener('click', openAlerts);
        }

        _hydrateCommandDeckUser();
        _syncFocusDeckAccess();
        _updateSidebarCommandDeck();
    }

    function _hydrateCommandDeckUser() {
        const user = _getCurrentSidebarUser();
        if (!user) return;
        const avatarEl = document.getElementById('sidebarIdentityAvatar');
        const nameEl = document.getElementById('sidebarIdentityName');
        const roleEl = document.getElementById('sidebarIdentityRole');
        const cardEl = document.getElementById('sidebarIdentityCard');
        _paintUserAvatar(avatarEl, user);
        if (nameEl) nameEl.textContent = user.name || user.username || 'Event Genix';
        if (roleEl) roleEl.textContent = _sidebarRoleLine(user);
        _bindProfileEntry(cardEl);
    }

    function _setCommandDescription(widget, text) {
        if (!widget || !text) return;
        widget.removeAttribute('title');
        widget.setAttribute('aria-label', text);
    }

    function _setFocusChipOperationalState(widget, count, options = {}) {
        if (!widget) return;
        const safeCount = Math.max(0, Number(count || 0));
        const severity = options.critical ? 'critical' : (options.hot ? 'hot' : (safeCount > 0 ? 'live' : 'idle'));
        widget.dataset.sidebarCount = String(safeCount);
        widget.dataset.sidebarSeverity = severity;
        widget.classList.remove('is-zero', 'is-live', 'is-hot', 'is-critical');
        widget.classList.add(safeCount > 0 ? 'is-live' : 'is-zero');
        if (severity === 'hot') widget.classList.add('is-hot');
        if (severity === 'critical') widget.classList.add('is-critical');
        _updateSidebarCommandDeck();
        _syncNavStatusLabels();
    }

    function _getSidebarSummaryState() {
        if (_commandState.alertsCritical > 0) return `Є ${_formatSignalCount(_commandState.alertsCritical)} критичних алертів`;
        if (_commandState.alertsUnread > 0) return `${_formatSignalCount(_commandState.alertsUnread)} нових алертів потребують уваги`;
        if (_commandState.tasksOverdue > 0) return `${_formatSignalCount(_commandState.tasksOverdue)} прострочені задачі у фокусі`;
        if (_commandState.hotLeads > 0) return `${_formatSignalCount(_commandState.hotLeads)} гарячих лідів чекають дії`;
        if (_commandState.tasksActive > 0) return `${_formatSignalCount(_commandState.tasksActive)} задачі в роботі`;
        return 'Система стабільна';
    }

    function _getSidebarPrimaryAction(role, state) {
        const salesRoles = ['creator', 'director', 'vice_director', 'manager', 'senior_manager', 'marketer', 'reception'];
        if (state.alertsCritical > 0 || state.alertsUnread > 0) {
            return { label: 'Розібрати алерти', kicker: state.alertsCritical > 0 ? 'Критично' : 'Увага', action: 'alerts' };
        }
        if (state.tasksOverdue > 0) {
            return { label: 'Закрити прострочені задачі', kicker: 'Фокус', href: '/tasks?view=my&filter=overdue' };
        }
        if ((state.hotLeads > 0 || state.newLeads > 0) && salesRoles.includes(role)) {
            return { label: 'Обробити гарячі ліди', kicker: 'Продажі', href: '/sales-funnel?filter=hot' };
        }
        if (['hr', 'admin'].includes(role)) {
            return { label: 'Перевірити команду', kicker: 'Команда', href: '/hr#team' };
        }
        if (['art_director', 'marketer'].includes(role)) {
            return { label: 'Відкрити контент-потік', kicker: 'Продукт', href: '/content' };
        }
        return { label: 'Відкрити центр керування', kicker: 'AI фокус', href: '/dashboard' };
    }

    function _updateSidebarCommandDeck() {
        const summaryEl = document.getElementById('sidebarIdentitySummary');
        if (summaryEl) summaryEl.textContent = _getSidebarSummaryState();

        const actionEl = document.getElementById('sidebarPrimaryAction');
        if (!actionEl) return;
        const user = _getCurrentSidebarUser();
        const role = _getSidebarPrimaryRole(user) || (typeof getUserRole === 'function' ? getUserRole() : '');
        const action = _getSidebarPrimaryAction(role, _commandState);
        actionEl.querySelector('.sidebar-primary-action-kicker')?.replaceChildren(document.createTextNode(action.kicker));
        actionEl.querySelector('.sidebar-primary-action-label')?.replaceChildren(document.createTextNode(action.label));
        actionEl.dataset.action = action.action || '';
        actionEl.dataset.href = action.href || '';
        if (actionEl.dataset.primaryBound !== 'true') {
            actionEl.dataset.primaryBound = 'true';
            actionEl.addEventListener('click', (event) => {
                const actionName = actionEl.dataset.action;
                const href = actionEl.dataset.href;
                if (actionName === 'alerts') {
                    openAlerts(event);
                    return;
                }
                if (href) window.location.href = href;
            });
        }
    }

    function _ensureActiveIndicator() {
        document.getElementById('sidebarActiveIndicator')?.remove();
    }

    function _updateActiveIndicator() {
        const indicator = document.getElementById('sidebarActiveIndicator');
        if (!indicator) return;
        indicator.remove();
    }

    function _initSpotlight() {
        const sidebar = document.getElementById('sidebarNav');
        if (!sidebar || sidebar.dataset.spotlightBound === 'true') return;
        sidebar.dataset.spotlightBound = 'true';
        sidebar.addEventListener('mousemove', (event) => {
            const rect = sidebar.getBoundingClientRect();
            sidebar.style.setProperty('--sb-mx', `${event.clientX - rect.left}px`);
            sidebar.style.setProperty('--sb-my', `${event.clientY - rect.top}px`);
        });
        sidebar.addEventListener('mouseleave', () => {
            sidebar.style.setProperty('--sb-mx', '50%');
            sidebar.style.setProperty('--sb-my', '-20%');
        });
    }

    function _motionReduced() {
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function _initRipple() {
        return;
    }

    function _initMagnetic() {
        return;
    }

    function _alertSetFromStorage(key) {
        try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
        catch { return new Set(); }
    }

    function _renderSidebarAlerts(data) {
        const widget = document.getElementById('focusChipAlerts');
        if (!widget) return;
        const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
        const dismissed = _alertSetFromStorage('crm_alerts_dismissed');
        const read = _alertSetFromStorage('crm_alerts_read_v2');
        const active = alerts.filter(alert => !dismissed.has(alert.id));
        const unread = active.filter(alert => !read.has(alert.id));
        const count = unread.length;
        const first = unread[0] || active[0] || null;
        const countEl = document.getElementById('focusChipAlertsValue');
        const metaEl = document.getElementById('focusChipAlertsMeta');
        if (countEl) {
            countEl.textContent = count > 99 ? '99+' : String(count);
        }
        if (metaEl) {
            if (!active.length) metaEl.textContent = 'спокійно';
            else if (count > 0) metaEl.textContent = 'нові';
            else metaEl.textContent = 'перегл.';
        }
        const alertTitle = !active.length
            ? 'Алерти: все спокійно. Натисніть, щоб відкрити повну інформацію.'
            : `Алерти: ${count} нових, ${active.length} активних. Натисніть, щоб відкрити повну інформацію.`;
        _commandState.alertsActive = active.length;
        _commandState.alertsUnread = count;
        _commandState.alertsCritical = unread.filter(alert => alert.level === 'critical').length;
        _setCommandDescription(widget, alertTitle);
        widget.classList.toggle('has-alerts', active.length > 0);
        widget.classList.toggle('has-critical', unread.some(alert => alert.level === 'critical'));
        _setFocusChipOperationalState(widget, active.length, {
            critical: unread.some(alert => alert.level === 'critical'),
            hot: count > 0
        });
    }

    function openAlerts(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (typeof _ensureAlertElements === 'function') _ensureAlertElements();
        if (typeof toggleAlertsPanel === 'function') {
            toggleAlertsPanel(event);
            return;
        }
        window.location.href = '/dashboard';
    }

    async function _refreshTaskMiniWidget() {
        if (_state.taskWidgetTimer) {
            clearTimeout(_state.taskWidgetTimer);
            _state.taskWidgetTimer = null;
        }
        const widget = document.getElementById('focusChipTasks');
        if (!widget) return;
        const token = localStorage.getItem('pzp_token');
        if (!token) return;
        try {
            const profile = await fetch('/api/auth/profile', {
                headers: { 'Authorization': 'Bearer ' + token }
            }).then(r => r.ok ? r.json() : null).catch(() => null);
            let activeCount = 0;
            let overdueCount = 0;
            if (profile?.tasks) {
                const tasks = profile.tasks || {};
                activeCount = Number(tasks.assigned || 0) + Number(tasks.in_progress || 0);
                overdueCount = Number(tasks.overdue || 0);
            } else {
                const rows = await fetch('/api/tasks?limit=80', {
                    headers: { 'Authorization': 'Bearer ' + token }
                }).then(r => r.ok ? r.json() : []).catch(() => []);
                const user = _getCurrentSidebarUser();
                const userId = Number(user?.id || user?.userId || 0);
                const tokens = new Set([user?.username, user?.name].map(v => String(v || '').trim()).filter(Boolean));
                const mine = Array.isArray(rows) ? rows.filter(task => {
                    const ownerId = Number(task.owner_user_id || task.ownerUserId || 0);
                    if (userId && ownerId && userId === ownerId) return true;
                    if (ownerId) return false;
                    return tokens.has(String(task.assigned_to || task.assignedTo || '').trim()) || tokens.has(String(task.owner || '').trim());
                }) : [];
                activeCount = mine.filter(task => !['done', 'cancelled', 'archived'].includes(task.status)).length;
                overdueCount = mine.filter(task => task.deadline && new Date(task.deadline) < new Date() && task.status !== 'done').length;
            }
            const countEl = document.getElementById('focusChipTasksValue');
            const metaEl = document.getElementById('focusChipTasksMeta');
            if (countEl) countEl.textContent = activeCount > 99 ? '99+' : String(activeCount);
            if (metaEl) {
                const parts = ['актив.'];
                if (overdueCount > 0) parts.push(`${overdueCount} простр.`);
                metaEl.textContent = parts.join(' · ');
            }
            const taskTitle = overdueCount > 0
                ? `Задачі: ${activeCount} активних, ${overdueCount} прострочених. Натисніть, щоб відкрити всі задачі.`
                : `Задачі: ${activeCount} активних. Натисніть, щоб відкрити всі задачі.`;
            _commandState.tasksActive = activeCount;
            _commandState.tasksOverdue = overdueCount;
            _setCommandDescription(widget, taskTitle);
            widget.classList.toggle('has-overdue', overdueCount > 0);
            _setFocusChipOperationalState(widget, activeCount, { critical: overdueCount > 0 });
        } catch {}
        _state.taskWidgetTimer = setTimeout(_refreshTaskMiniWidget, 300000);
    }

    async function _refreshFunnelWidget() {
        if (_state.funnelWidgetTimer) {
            clearTimeout(_state.funnelWidgetTimer);
            _state.funnelWidgetTimer = null;
        }
        const widget = document.getElementById('focusChipFunnel');
        if (!widget) return;
        const user = _getCurrentSidebarUser();
        const role = _getSidebarPrimaryRole(user) || (typeof getUserRole === 'function' ? getUserRole() : null);
        const canSeeFunnel = role ? hasAccess({ access: 'leads' }, role) : true;
        widget.hidden = !canSeeFunnel;
        _syncFocusDeckAccess(canSeeFunnel);
        if (!canSeeFunnel) return;

        const token = localStorage.getItem('pzp_token');
        if (!token) return;
        try {
            const [hotR, newR] = await Promise.allSettled([
                fetch('/api/leads/hot', { headers: { 'Authorization': 'Bearer ' + token } }).then(r => r.ok ? r.json() : null),
                fetch('/api/leads/new-count', { headers: { 'Authorization': 'Bearer ' + token } }).then(r => r.ok ? r.json() : null)
            ]);
            const hotLeads = hotR.status === 'fulfilled' && Array.isArray(hotR.value?.leads) ? hotR.value.leads : [];
            const actionCount = hotLeads.length;
            const newCount = newR.status === 'fulfilled' ? Number(newR.value?.count || 0) : 0;
            const displayCount = actionCount > 0 ? actionCount : newCount;
            const firstLead = hotLeads[0] || null;
            const countEl = document.getElementById('focusChipFunnelValue');
            const metaEl = document.getElementById('focusChipFunnelMeta');

            if (countEl) countEl.textContent = displayCount > 99 ? '99+' : String(displayCount);
            if (metaEl) {
                if (actionCount > 0) {
                    metaEl.textContent = newCount > 0
                        ? `дії · ${newCount} нов.`
                        : 'дії';
                } else if (newCount > 0) {
                    metaEl.textContent = 'нові';
                } else {
                    metaEl.textContent = 'без нових';
                }
            }
            const funnelTitle = actionCount > 0
                ? `Воронка: ${actionCount} лідів чекає дії, ${newCount} нових. Натисніть, щоб відкрити повну воронку.`
                : `Воронка: ${newCount} нових лідів. Натисніть, щоб відкрити повну воронку.`;
            _commandState.hotLeads = actionCount;
            _commandState.newLeads = newCount;
            _setCommandDescription(widget, funnelTitle);
            widget.classList.toggle('has-action', actionCount > 0);
            widget.classList.toggle('has-new', actionCount === 0 && newCount > 0);
            _setFocusChipOperationalState(widget, displayCount, { hot: actionCount > 0 || newCount > 0 });
            widget.href = firstLead?.id ? `/sales-funnel?lead=${encodeURIComponent(firstLead.id)}` : '/sales-funnel';
        } catch {}
        _state.funnelWidgetTimer = setTimeout(_refreshFunnelWidget, 300000);
    }

    function _getCurrentSidebarUser() {
        let user = typeof AppState !== 'undefined' ? AppState.currentUser : null;
        if (user) return user;
        try {
            const saved = localStorage.getItem('pzp_current_user');
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    }

    function _getSidebarPrimaryRole(user) {
        const roles = Array.isArray(user?.roles) ? user.roles : [];
        return String(user?.role || user?.account_role || user?.accountRole || roles[0] || '').trim();
    }

    function _syncFocusDeckAccess(forceFunnelAccess = null) {
        const deck = document.getElementById('sidebarFocusDeck');
        const funnel = document.getElementById('focusChipFunnel');
        if (!deck || !funnel) return;
        const user = _getCurrentSidebarUser();
        const role = _getSidebarPrimaryRole(user) || (typeof getUserRole === 'function' ? getUserRole() : null);
        const canSeeFunnel = forceFunnelAccess === null
            ? (role ? hasAccess({ access: 'leads' }, role) : true)
            : !!forceFunnelAccess;
        funnel.hidden = !canSeeFunnel;
        deck.classList.toggle('has-funnel', canSeeFunnel);
        deck.dataset.visibleCount = canSeeFunnel ? '3' : '2';
    }

    function initUserCard() {
        let user = _getCurrentSidebarUser();
        if (!user) return;
        const avatarEl = document.getElementById('sidebarUserAvatar');
        const compactAvatarEl = document.getElementById('sidebarCompactAvatar');
        const nameEl = document.getElementById('sidebarUserName');
        const roleEl = document.getElementById('sidebarUserRole');
        const cardEl = document.getElementById('sidebarUserCard');
        _paintUserAvatar(avatarEl, user);
        _paintUserAvatar(compactAvatarEl, user);
        if (nameEl) nameEl.textContent = user.name || user.username || '';
        if (roleEl) roleEl.textContent = _sidebarRoleLine(user);
        _bindProfileEntry(cardEl);
        _bindProfileEntry(nameEl);
        _hydrateCommandDeckUser();
        _syncFocusDeckAccess();
        _updateSidebarCommandDeck();
        if (!_state.roleRenderApplied && Object.keys(_getGroupState()).length === 0) {
            _state.roleRenderApplied = true;
            const links = document.querySelector('#sidebarLinks') || document.querySelector('#sidebarNav .sidebar-links');
            if (links?.id) render('#' + links.id);
        }
    }

    function _paintUserAvatar(el, user) {
        if (!el || !user) return;
        const photo = user.avatar_url || user.avatarUrl || user.photo_url || user.photoUrl || user.image_url || user.imageUrl;
        const emoji = user.avatar_emoji || user.avatarEmoji;
        const customColor = user.avatar_color || user.avatarColor;
        el.classList.toggle('has-photo', !!photo);
        if (photo) {
            el.innerHTML = `<img src="${_escAttr(photo)}" alt="">`;
            el.style.background = 'transparent';
            return;
        }
        if (emoji) {
            el.textContent = emoji;
            el.style.background = customColor || '#f59e0b';
            return;
        }
        const label = user.name || user.username || '?';
        const initial = label.trim().charAt(0).toUpperCase() || '?';
        const roleColors = {
            creator: '#f59e0b',
            director: '#6366f1',
            vice_director: '#8b5cf6',
            senior_manager: '#0ea5e9',
            manager: '#10b981',
            admin: '#06b6d4',
            hr: '#ec4899',
            accountant: '#22c55e',
            art_director: '#a855f7',
            marketer: '#f97316'
        };
        const colors = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444'];
        el.textContent = initial;
        el.style.background = customColor || roleColors[user.role] || colors[(user.id || 0) % colors.length];
    }

    function _bindProfileEntry(el) {
        if (!el || el.dataset.sidebarProfileBound === 'true') return;
        el.dataset.sidebarProfileBound = 'true';
        el.setAttribute('role', 'link');
        el.setAttribute('tabindex', '0');
        el.setAttribute('title', 'Відкрити профіль');
        const go = () => { window.location.href = '/profile'; };
        el.addEventListener('click', (e) => {
            if (e.target.closest('[data-sidebar-stop-profile="true"]')) return;
            e.preventDefault();
            go();
        });
        el.addEventListener('keydown', (e) => {
            if (e.target.closest('[data-sidebar-stop-profile="true"]')) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                go();
            }
        });
    }

    function _escAttr(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    // ═══ TOGGLE SIDEBAR (mobile/desktop) ══════════════════════════
    function initToggle() {
        const toggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebarNav');
        const overlay = document.getElementById('sidebarOverlay');
        const collapseBtn = document.getElementById('sidebarCollapseBtn');
        _removeLegacySidebarActions(sidebar);
        _ensureCompactProfileAvatar(sidebar);
        if (collapseBtn && sidebar && collapseBtn.dataset.sidebarCollapseBound !== 'true') {
            collapseBtn.dataset.sidebarCollapseBound = 'true';
            if (localStorage.getItem('pzp_sidebar_collapsed') === 'true') {
                sidebar.classList.add('collapsed');
            }
            collapseBtn.addEventListener('click', () => {
                const isCollapsed = sidebar.classList.toggle('collapsed');
                localStorage.setItem('pzp_sidebar_collapsed', String(isCollapsed));
            });
        }
        if (toggle && sidebar && toggle.dataset.sidebarToggleBound !== 'true') {
            toggle.dataset.sidebarToggleBound = 'true';
            toggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
                if (overlay) overlay.classList.toggle('hidden', !sidebar.classList.contains('open'));
            });
        }
        if (overlay && sidebar && overlay.dataset.sidebarOverlayBound !== 'true') {
            overlay.dataset.sidebarOverlayBound = 'true';
            overlay.addEventListener('click', () => {
                sidebar.classList.remove('open');
                overlay.classList.add('hidden');
            });
        }
        if (sidebar && sidebar.dataset.sidebarLinkBound !== 'true') {
            sidebar.dataset.sidebarLinkBound = 'true';
            sidebar.addEventListener('click', (e) => {
                const link = e.target.closest('.nav-link, .sidebar-quick-nav-link, .focus-chip, .sidebar-primary-action');
                if (!link) return;
                if (window.innerWidth <= 768 && overlay) { sidebar.classList.remove('open'); overlay.classList.add('hidden'); }
            });
        }
        // Theme toggle — inject at bottom of sidebar
        _initThemeToggle(sidebar);

        // Desktop collapsed state remains owned by the shared shell controls.
    }

    function _removeLegacySidebarActions(sidebar) {
        const root = sidebar || document;
        root.querySelectorAll('#sidebarActions, .sidebar-actions').forEach((el) => el.remove());
        [
            'sidebarHistoryBtn',
            'sidebarAfishaBtn',
            'sidebarCertificatesBtn',
            'sidebarDashboardBtn',
            'sidebarSettingsBtn',
            'sidebarDigestBtn',
            'sidebarPointsBtn'
        ].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
    }

    function _ensureCompactProfileAvatar(sidebar) {
        if (!sidebar || document.getElementById('sidebarCompactProfile')) return;
        const brand = sidebar.querySelector('.sidebar-brand');
        if (!brand) return;
        const link = document.createElement('a');
        link.id = 'sidebarCompactProfile';
        link.className = 'sidebar-compact-profile';
        link.href = '/profile';
        link.title = 'Відкрити профіль';
        link.innerHTML = '<span class="sidebar-user-avatar" id="sidebarCompactAvatar">?</span>';
        brand.appendChild(link);
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
        btn.innerHTML = `${_renderIcon(isDark ? 'sun' : 'moon')}<span class="nav-text">${isDark ? 'Світла тема' : 'Темна тема'}</span>`;

        btn.addEventListener('click', () => {
            const nowDark = document.body.classList.toggle('dark-mode');
            localStorage.setItem('pzp_dark_mode', String(nowDark));
            document.documentElement.setAttribute('data-theme', nowDark ? 'dark' : 'light');
            const iconEl = btn.querySelector('.nav-icon');
            if (iconEl) iconEl.outerHTML = _renderIcon(nowDark ? 'sun' : 'moon');
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
        document.body.classList.add('shell-baseline');
        _ensureCollapsedGroupsBaseline();
        render(containerSelector);
        initToggle();
        _initPageTransitions();
        // Fill user card immediately + keep retrying until avatar shows real initial
        if (!_state.userRetryStarted) {
            _state.userRetryStarted = true;
            _retryUserCard();
        } else {
            initUserCard();
        }
    }

    // ─── Page transition animations ────────────────────────────────
    function _initPageTransitions() {
        if (!_state.scrollRestored) {
            _state.scrollRestored = true;
            try {
                Object.keys(sessionStorage).forEach((key) => {
                    if (key.startsWith('sidebar_scroll_')) sessionStorage.removeItem(key);
                });
            } catch {}
            const sidebar = document.getElementById('sidebarNav');
            if (sidebar) {
                sidebar.scrollTop = 0;
            }
        }
        if (_state.transitionsBound) return;
        _state.transitionsBound = true;

        document.addEventListener('click', (e) => {
            const link = e.target.closest('.sidebar-links .nav-link[href]');
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if (!link || link.getAttribute('onclick')) return;
            const href = link.getAttribute('href');
            if (!href || href.startsWith('#')) return;

            // Same-page hash navigation (e.g. /designs#catalogs while on /designs)
            const hrefBase = href.split('#')[0];
            const hrefHash = href.includes('#') ? href.split('#')[1] : '';
            const currentBase = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
            if (hrefBase === currentBase) {
                if (hrefHash) {
                    e.preventDefault();
                    window.location.hash = '#' + hrefHash;
                    // Update active states in sidebar
                    const container = link.closest('.sidebar-links');
                    if (container) {
                        container.querySelectorAll('.nav-link').forEach(l => {
                            const lHref = l.getAttribute('href') || '';
                            const lBase = lHref.split('#')[0];
                            const lHash = lHref.includes('#') ? lHref.split('#')[1] : '';
                            if (lBase === hrefBase) {
                                l.classList.toggle('active', lHash === hrefHash);
                            }
                        });
                        _queueActiveIndicatorUpdate();
                    }
                    return;
                }
                // Same path, no hash — already on page, do nothing
                if (!window.location.hash) return;
                // Had hash, clicking base link — clear hash and reload to reset tab
                e.preventDefault();
                window.location.hash = '';
                window.location.reload();
                return;
            }

            e.preventDefault();
            const sidebar = document.getElementById('sidebarNav');
            if (sidebar) sidebar.scrollTop = 0;
            document.body.classList.add('shell-baseline', 'page-exiting');
            document.body.classList.remove('shell-ready');
            document.body.setAttribute('aria-busy', 'true');
            const navigate = () => { window.location.assign(href); };
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(navigate);
            } else {
                navigate();
            }
        });
    }

    async function _retryUserCard() {
        initUserCard();
        const avatarEl = document.getElementById('sidebarUserAvatar');
        const stillDefault = !avatarEl || avatarEl.textContent.trim() === '?';
        if (!stillDefault) return; // Already showing real initial

        // Try polling AppState/localStorage a few times (page JS may set it async)
        if (!_retryUserCard._attempt) _retryUserCard._attempt = 0;
        _retryUserCard._attempt++;
        const delays = [100, 300, 600, 1000, 2000];
        if (_retryUserCard._attempt <= delays.length) {
            setTimeout(_retryUserCard, delays[_retryUserCard._attempt - 1]);
            return;
        }

        // Last resort: fetch user from server directly
        try {
            const token = localStorage.getItem('pzp_token');
            if (!token) return;
            const res = await fetch('/api/auth/verify', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) return;
            const data = await res.json();
            const user = data.user || data;
            if (user && user.name) {
                if (typeof AppState !== 'undefined') AppState.currentUser = user;
                localStorage.setItem('pzp_current_user', JSON.stringify(user));
                initUserCard();
            }
        } catch {}
    }

    window.addEventListener('roleSwitched', () => {
        const c = document.querySelector('#sidebarLinks') || document.querySelector('#sidebarNav .sidebar-links');
        if (c) render('#' + c.id);
    });
    window.addEventListener('crm:alerts-updated', (event) => {
        _renderSidebarAlerts({ alerts: event.detail?.alerts || [] });
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

    return {
        init,
        render,
        initToggle,
        checkPageAccess,
        toggleGroup,
        openAlerts,
        initUserCard,
        markShellReady: _markShellReady,
        clearShellReady: _clearShellReady,
        NAV_ITEMS,
        SIDEBAR_ACCESS,
        hasAccess
    };
})();
