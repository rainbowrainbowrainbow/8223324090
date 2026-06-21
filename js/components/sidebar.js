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
        identityMetaTimer: null,
        identityMetaLoading: false,
        identityMetaLoadedAt: 0,
        identityMetaDetails: {},
        liveCountersPromise: null,
        liveCountersUrl: '',
        roleRenderApplied: false,
        extraEditingId: '',
        railCloseTimer: null,
        railActiveAnchor: null,
        railPinned: false,
        businessSwitching: false,
        businessSettingsOpen: false,
        businessSettingsDocumentBound: false
    };
    const GROUP_STATE_VERSION = 'ai-cockpit-v2';
    const EXTRA_MENU_HREFS = ['/', '/staff', '/chat', '/certificates'];
    const EXTRA_MENU_STORAGE_KEY = 'eg_sidebar_extra_menu_items_v3';
    const EXTRA_MENU_EDIT_STORAGE_KEY = 'eg_sidebar_extra_menu_edit_v1';
    const EXTRA_MENU_COLLAPSED_STORAGE_KEY = 'eg_sidebar_extra_menu_collapsed_v1';
    const PRODUCTIVITY_MENU_STORAGE_KEY = 'eg_sidebar_productivity_menu_items_v1';
    const PRODUCTIVITY_MENU_EDIT_STORAGE_KEY = 'eg_sidebar_productivity_menu_edit_v1';
    const PRODUCTIVITY_MENU_COLLAPSED_STORAGE_KEY = 'eg_sidebar_productivity_menu_collapsed_v1';
    const SIDEBAR_CURRENCY_SIGNAL_STORAGE_KEY = 'eg_sidebar_currency_signal_enabled_v1';
    const PRODUCTIVITY_QUICK_DEFAULT_HREFS = ['/profile?tab=myday'];
    const PRODUCTIVITY_QUICK_ITEMS = Object.freeze([
        { href: '/profile?tab=myday', icon: 'task', label: 'Мій день', description: 'особистий фокус' },
        { href: '/tasks?view=my', icon: 'task', label: 'Мої задачі', description: 'повний список', access: 'tasks', businessModule: 'tasks' },
        { href: '/tasks?view=today', icon: 'calendar', label: 'Сьогодні', description: 'план на день', access: 'tasks', businessModule: 'tasks' },
        { href: '/tasks?view=waiting', icon: 'alert', label: 'Очікування', description: 'завислі задачі', access: 'tasks', businessModule: 'tasks' },
        { href: '/profile?tab=achievements', icon: 'analytics', label: 'Досягнення', description: 'прогрес і нагороди' }
    ]);
    const UTILITY_RAIL_PRIMARY_HREFS = ['/dashboard', '/', '/tasks', '/chat'];
    const UTILITY_RAIL_CONTEXT_GROUPS = ['sales', 'product', 'team', 'system'];
    const UTILITY_RAIL_MAX_FAVORITES = 4;
    const UTILITY_RAIL_MAX_GROUP_LINKS = 5;
    const RAIL_SHORT_LABEL_BY_HREF = new Map([
        ['/dashboard', 'Даш'],
        ['/', 'ТЛ'],
        ['/maysternya-doli', 'МД'],
        ['/tasks', 'Задачі'],
        ['/chat', 'Чат'],
        ['/customers', 'Клієнт'],
        ['/sales-funnel', 'Ліди'],
        ['/omni', 'Omni'],
        ['/omni#accounts', 'Чати'],
        ['/reports', 'Звіти'],
        ['/finance', 'Фін'],
        ['/copilot', 'AI'],
        ['/staff', 'Графік'],
        ['/hr', 'Пульс'],
        ['/hr#team', 'Команда'],
        ['/hr#structure', 'Структ'],
        ['/hr#payroll', 'ЗП/KPI'],
        ['/hr#other', 'Ваканс'],
        ['/training', 'Навч'],
        ['/checkin', 'Check'],
        ['/programs', 'Прод'],
        ['/programs#animation', 'Анім'],
        ['/programs#kitchen-cakes', 'Торти'],
        ['/programs#kitchen-menu', 'Меню'],
        ['/programs#catalogs', 'Каталог'],
        ['/content', 'Контент'],
        ['/art', 'Арт'],
        ['/graduation', 'Випуск'],
        ['/designs', 'Дизайн'],
        ['/designer', 'Стиль'],
        ['/sound#projects', 'Звук'],
        ['/sound#library', 'Аудіо'],
        ['/sound#announcements', 'Огол'],
        ['/afisha', 'Афіша'],
        ['/certificates', 'Серти'],
        ['/certificates/new', 'Видати'],
        ['/certificates/batch', 'Пакет'],
        ['/kleshnya', 'AI'],
        ['/guardian-ops', 'Ops'],
        ['/center', 'Центр'],
        ['/warehouse', 'Склад'],
        ['/game', 'Гра'],
        ['/demo', 'Demo'],
        ['#settings', 'Налашт']
    ]);
    const MAYSTERNYA_QUICK_ACCESS_HREFS = ['/maysternya-doli', '/sales-funnel', '/customers', '/omni#accounts', '/tasks', '/chat'];
    const MAYSTERNYA_SIDEBAR_HREFS = new Set([
        '/maysternya-doli',
        '/tasks',
        '/chat',
        '/customers',
        '/sales-funnel',
        '/omni',
        '/omni#accounts',
        '/reports',
        '#settings'
    ]);
    const MAYSTERNYA_ACCESS_OVERRIDES = new Set(['maysternya_doli', 'customers', 'leads', 'omni']);
    const EXTRA_MENU_DEFAULT_DESCRIPTION = 'вкладка CRM';
    const EXTRA_MENU_CUSTOM_DESCRIPTION = 'користувацька сторінка';
    const EXTRA_MENU_ICON_FALLBACK = 'crm';
    const SIDEBAR_IDENTITY_WIDGETS = {
        currency: '/api/dashboard/widgets/currency'
    };
    const COMMAND_DEFAULT_STATE = {
        tasksActive: 0,
        tasksCompleted: 0,
        tasksOverdue: 0,
        alertsActive: 0,
        alertsUnread: 0,
        alertsCritical: 0,
        hotLeads: 0,
        newLeads: 0
    };
    const _commandState = { ...COMMAND_DEFAULT_STATE };
    const SIDEBAR_COMPONENTS = Object.freeze({
        SidebarShell: 'sidebar-nav',
        SidebarBrand: 'sidebar-brand',
        UserSummaryCard: 'sidebar-identity-card',
        MetricChip: 'focus-chip',
        QuickAccess: 'sidebar-design-extras',
        SidebarSection: 'sidebar-group',
        SidebarItem: 'nav-link'
    });

    // ═══ NAV_ITEMS ════════════════════════════════════════════════
    const NAV_ITEMS = [
        { type: 'group', key: 'today', label: 'Сьогодні', icon: '🏠', priority: 1, defaultOpen: true },
        { href: '/dashboard',    icon: '🏠', label: 'Дашборд',       access: 'all',            group: 'today' },
        { href: '/',             icon: '📅', label: 'Таймлайн', access: 'timeline',       group: 'today' },
        { href: '/maysternya-doli', icon: '◇', label: 'Таймлайн МД', access: 'maysternya_doli', group: 'today' },
        { href: '/tasks',        icon: '✅', label: 'Задачі',        access: 'tasks',          group: 'today', statusKey: 'tasks' },
        { href: '/chat',         icon: '💬', label: 'Чат',           access: 'chat',           group: 'today', statusKey: 'chat' },
        { href: '/staff',        icon: '🗓️', label: 'Графік',        access: 'schedule_daily', group: 'today', quickAccessOnly: true },

        { type: 'group', key: 'sales', label: 'Продажі', icon: '🔥', priority: 2, defaultOpen: true },
        { href: '/',             icon: '📅', label: 'Таймлайн', access: 'timeline',       group: 'sales' },
        { href: '/customers',    icon: '👥', label: 'Клієнти',       access: 'customers',      group: 'sales' },
        { href: '/sales-funnel', icon: '🔥', label: 'Ліди',          access: 'leads',          group: 'sales', statusKey: 'leads' },
        { href: '/omni',         icon: '✉', label: 'Комунікації',    access: 'omni',           group: 'sales', statusKey: 'omni' },
        { href: '/omni#accounts', icon: '🔌', label: 'Підключення чатів', access: 'omni', group: 'sales', businessModule: 'omni' },
        { href: '/reports',      icon: '📋', label: 'Звіти',         access: 'reports',        group: 'sales' },
        { href: '/finance',      icon: '📊', label: 'Фінанси та аналітика', access: 'finance', group: 'sales' },
        { href: '/copilot',      icon: '🤖', label: 'AI менеджер',   access: 'copilot',        group: 'sales' },

        { type: 'group', key: 'team', label: 'HR', icon: '🤝', priority: 3, defaultOpen: false },
        { href: '/hr',           icon: '🤝', label: 'Пульс компанії', access: 'hr_page',        group: 'team', description: 'сьогодні, графік, звіти', activeHashes: ['today', 'schedule', 'reports'] },
        { href: '/hr#team',      icon: '👥', label: 'Команда',       access: 'hr_page',        group: 'team', pageAccess: '/hr', description: 'робітники, стажери, резерв, чорний список, звільнені', activeHashes: ['team', 'workers', 'interns', 'reserve', 'blacklist', 'dismissed'] },
        { href: '/hr#structure', icon: 'center', label: 'Структура', access: 'hr_page',        group: 'team', pageAccess: '/hr', description: 'структура, професії, чек-листи, акаунти', activeHashes: ['structure', 'professions', 'checklists', 'accounts'] },
        { href: '/hr#payroll',   icon: '📊', label: 'ЗП та KPI',     access: 'hr_page',        group: 'team', pageAccess: '/hr', description: 'зарплата, ЗРС, KPI', activeHashes: ['payroll', 'salary', 'zrs', 'kpi'] },
        { href: '/checkin',      icon: '📸', label: 'Check-in',      access: 'hr_page',        group: 'team' },
        { href: '/hr#other',     icon: '🧭', label: 'Вакансії',     access: 'hr_page',        group: 'team', pageAccess: '/hr', description: 'вакансії, відгуки, співбесіди, шаблони', activeHashes: ['other', 'vacancies'] },
        { href: '/training',     icon: '🎓', label: 'Навчання',      access: 'training',       group: 'team', description: 'матеріали, тести, онбординг', activeHashes: ['materials', 'tests', 'progress', 'leaderboard', 'onboarding'] },

        { type: 'group', key: 'product', label: 'Продукт', icon: '🎨', priority: 4, defaultOpen: false },
        { href: '/programs',     icon: '🧩', label: 'Продукти',       access: 'programs',       group: 'product' },
        { href: '/programs#animation', icon: '🎪', label: 'Анімації', access: 'programs',       group: 'product' },
        { href: '/programs#kitchen-cakes', icon: '🎂', label: 'Торти', access: 'programs',       group: 'product' },
        { href: '/programs#kitchen-menu', icon: '🍽️', label: 'Меню',  access: 'programs',       group: 'product' },
        { href: '/programs#catalogs', icon: '📚', label: 'Каталоги продуктів', access: 'programs', group: 'product' },
        { href: '/content',      icon: '📱', label: 'Контент',       access: 'content',        group: 'product' },
        { href: '/art',          icon: '🎨', label: 'Арт',           access: 'art',            group: 'product' },
        { href: '/graduation',   icon: '🎓', label: 'Випускний',     access: 'graduation',     group: 'product' },
        { href: '/designs',      icon: '🖼️', label: 'Дизайн-борд',   access: 'art',            group: 'product' },
        { href: '/designer',     icon: '📖', label: 'Стайлгайд',     access: 'art',            group: 'product' },
        { href: '/sound#projects',      icon: '🎬', label: 'Звук',   access: 'sound',          group: 'product' },
        { href: '/sound#library',       icon: '🎵', label: 'Бібліотека звуку', access: 'sound', group: 'product' },
        { href: '/sound#announcements', icon: '📢', label: 'Оголошення', access: 'sound',      group: 'product' },
        { href: '/afisha',       icon: '🎭', label: 'Афіша',         access: 'afisha',         group: 'product' },
        { href: '/certificates', icon: '🎫', label: 'Сертифікати',   access: 'certificates',   group: 'product' },
        { href: '/certificates/new', icon: '🎫', label: 'Видати сертифікат або абонемент', access: 'certificates', group: 'product', quickAccessOnly: true },
        { href: '/certificates/batch', icon: '📦', label: 'Пакет сертифікатів на одноразовий вхід', access: 'certificates', group: 'product', quickAccessOnly: true },

        { type: 'group', key: 'system', label: 'Система', icon: '⚙️', priority: 5, defaultOpen: false },
        { href: '/kleshnya',     icon: '🤖', label: 'Помічник',        access: 'chat',           group: 'system' },
        { href: '/guardian-ops', icon: '🛡️', label: 'Guardian Ops',  access: 'guardian_ops',   group: 'system' },
        { href: '/center',       icon: '🎛️', label: 'Центр керування', access: 'center',       group: 'system' },
        { href: '/timeline-settings', icon: '📅', label: 'Налаштування таймлайну', access: 'settings', group: 'system' },
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
        timeline:       [..._ADMIN_UP, 'reception', 'animator', 'senior_instructor', 'instructor', 'security'],
        maysternya_doli: ['creator'],
        management:     [..._MGR_UP, 'admin', 'marketer'],
        leads:          [..._MGR_UP, 'marketer'],
        omni:           _MGR_UP,
        copilot:        _MGR_UP,
        staff:          [..._MGR_UP, 'admin', 'hr', 'senior_instructor', 'instructor', 'it_specialist', 'security'],
        hr:             [..._MGR_UP, 'hr', 'admin', 'security'],
        hr_page:        [..._MGR_UP, 'hr', 'admin', 'security'],
        finance:        ['creator', 'director', 'accountant'],
        analytics:      ['creator', 'director', 'accountant'],
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
        schedule_daily: _ALL_STAFF,
        customers:      [..._ADMIN_UP, 'reception'],
        warehouse:      [..._MGR_UP, 'admin'],
        training:       [..._MGR_UP, 'hr', 'senior_instructor', 'instructor'],
    };

    const HR_TEAM_BUCKET_IDS = ['workers', 'interns', 'reserve', 'blacklist', 'dismissed'];
    const HR_TEAM_BUCKET_VISIBILITY_MANAGERS = ['creator', 'director', 'vice_director'];
    const HR_TEAM_BUCKET_VISIBILITY = {
        creator: HR_TEAM_BUCKET_IDS,
        director: HR_TEAM_BUCKET_IDS,
        vice_director: HR_TEAM_BUCKET_IDS,
        senior_manager: ['workers', 'interns', 'reserve', 'dismissed'],
        manager: ['workers', 'interns', 'reserve', 'dismissed'],
        hr: HR_TEAM_BUCKET_IDS,
        hr_manager: HR_TEAM_BUCKET_IDS,
        admin: ['workers', 'interns', 'dismissed'],
        security: ['workers', 'blacklist'],
        it_specialist: ['workers', 'interns'],
        senior_instructor: ['workers', 'interns'],
        instructor: ['workers', 'interns'],
        accountant: ['workers'],
        marketer: ['workers'],
        art_director: ['workers'],
        reception: ['workers'],
        animator: ['workers'],
        pastry_chef: ['workers'],
        head_pastry: ['workers'],
        cook: ['workers'],
        head_chef: ['workers'],
        waiter: ['workers'],
        dishwasher: ['workers'],
        maintenance: ['workers'],
        cleaning: ['workers'],
        wardrobe: ['workers'],
        barista: ['workers'],
        default: ['workers']
    };

    // Template-only until HR gets a persistent settings screen for these rules.
    function _hrTeamBucketRoles(user, role) {
        const previewRole = typeof window !== 'undefined'
            ? (window.RolePreview?.getPreviewRole?.() || window.RolePreview?.getEffectiveRole?.())
            : '';
        if (previewRole) return [String(previewRole).trim()].filter(Boolean);
        const values = [role, user?.role, user?.account_role, user?.accountRole];
        if (Array.isArray(user?.roles)) values.push(...user.roles);
        if (Array.isArray(user?.extraRoles)) values.push(...user.extraRoles);
        if (Array.isArray(user?.extra_roles)) values.push(...user.extra_roles);
        return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
    }

    function _hrVisibleBucketsForRole(role) {
        const key = String(role || '').trim();
        const configured = HR_TEAM_BUCKET_VISIBILITY[key] || HR_TEAM_BUCKET_VISIBILITY.default;
        return new Set((Array.isArray(configured) ? configured : []).filter(id => HR_TEAM_BUCKET_IDS.includes(id)));
    }

    function _canSeeHrTeamBucket(bucketId, user = _getCurrentSidebarUser(), role = _getSidebarActiveRole(user)) {
        if (!HR_TEAM_BUCKET_IDS.includes(bucketId)) return false;
        const roles = _hrTeamBucketRoles(user, role);
        if (!roles.length) return _hrVisibleBucketsForRole('default').has(bucketId);
        if (roles.some(value => value === 'creator')) return true;
        const visible = new Set();
        roles.forEach(value => _hrVisibleBucketsForRole(value).forEach(id => visible.add(id)));
        return visible.has(bucketId);
    }

    function _canManageHrTeamBucketVisibility(user = _getCurrentSidebarUser(), role = _getSidebarActiveRole(user)) {
        return _hrTeamBucketRoles(user, role).some(value => HR_TEAM_BUCKET_VISIBILITY_MANAGERS.includes(value));
    }

    function _isNavItemVisible(item, user = _getCurrentSidebarUser(), role = _getSidebarActiveRole(user)) {
        if (!item || typeof item.visible !== 'function') return true;
        try {
            return item.visible(user, role) !== false;
        } catch {
            return false;
        }
    }

    if (typeof window !== 'undefined') {
        window.HrTeamBucketAccess = {
            buckets: HR_TEAM_BUCKET_IDS.slice(),
            visibility: HR_TEAM_BUCKET_VISIBILITY,
            managers: HR_TEAM_BUCKET_VISIBILITY_MANAGERS.slice(),
            visibleBucketsForRole: (role) => Array.from(_hrVisibleBucketsForRole(role)),
            canSeeBucket: _canSeeHrTeamBucket,
            canManage: _canManageHrTeamBucketVisibility
        };
    }

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
        '🤖': 'ai',
        '🛡️': 'guardian',
        '🎮': 'game',
        '⚠️': 'alert',
        '📌': 'folder',
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
        const user = _getCurrentSidebarUser();
        const role = _getSidebarActiveRole(user);
        const first = NAV_ITEMS.find(i => i.href && i.href.includes('#') && i.href.split('#')[0] === basePath && _isNavItemVisible(i, user, role));
        return first ? first.href.split('#')[1] : '';
    }

    function _isSidebarItemActive(item, currentPath, currentHash) {
        if (!item || item.noActive || item.isHashLink) return false;
        const href = String(item.href || '');
        const itemPathWithSearch = href.split('#')[0];
        const searchIndex = itemPathWithSearch.indexOf('?');
        const itemBase = searchIndex >= 0 ? (itemPathWithSearch.slice(0, searchIndex) || '/') : itemPathWithSearch;
        const itemSearch = searchIndex >= 0 ? itemPathWithSearch.slice(searchIndex + 1) : '';
        const itemHash = href.includes('#') ? href.split('#')[1] : '';
        if (itemSearch) {
            try {
                const expected = new URLSearchParams(itemSearch);
                const current = new URLSearchParams(window.location.search || '');
                for (const [key, value] of expected.entries()) {
                    if (current.get(key) !== value) return false;
                }
            } catch {
                return false;
            }
        }
        const activeHashes = Array.isArray(item.activeHashes) ? item.activeHashes.map(String) : [];
        if (activeHashes.length && currentPath === itemBase) {
            if (currentHash) return activeHashes.includes(currentHash);
            if (!itemHash) return true;
        }
        if (itemHash) {
            if (currentPath !== itemBase) return false;
            if (currentHash) return currentHash === itemHash;
            const hasNonHashItem = NAV_ITEMS.some(n => !n.type && n.href === itemBase);
            if (hasNonHashItem) return false;
            const firstHash = NAV_ITEMS.find(n => !n.type && n.href?.startsWith(itemBase + '#'));
            return firstHash?.href === item.href;
        }
        return currentPath === itemBase && !currentHash;
    }

    function _normalizeExtraHref(value) {
        let href = String(value || '').trim();
        if (!href) return '';
        if (/^(https?:\/\/|mailto:|tel:|#)/i.test(href)) return href;
        if (!href.startsWith('/')) href = '/' + href;
        return href.replace(/\.html(?=$|#|\?)/i, '');
    }

    function _isExternalExtraHref(href) {
        return /^(https?:\/\/|mailto:|tel:)/i.test(String(href || ''));
    }

    function _makeExtraMenuId() {
        return 'extra_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    }

    function _labelFromExtraHref(href) {
        const clean = String(href || '').replace(/^https?:\/\//i, '').replace(/^\/+/, '').split(/[?#]/)[0];
        const last = clean.split('/').filter(Boolean).pop();
        return last ? last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) : 'Сторінка';
    }

    function _normalizeCustomExtraItem(item) {
        if (!item || typeof item !== 'object') return null;
        const href = _normalizeExtraHref(item.href);
        if (!href) return null;
        return {
            id: String(item.id || _makeExtraMenuId()),
            label: String(item.label || _labelFromExtraHref(href)).trim() || 'Сторінка',
            href,
            description: String(item.description || EXTRA_MENU_CUSTOM_DESCRIPTION).trim() || EXTRA_MENU_CUSTOM_DESCRIPTION,
            icon: String(item.icon || EXTRA_MENU_ICON_FALLBACK).trim() || EXTRA_MENU_ICON_FALLBACK,
            hidden: item.hidden === true,
            custom: true
        };
    }

    function _readCustomExtraItems() {
        try {
            const parsed = JSON.parse(localStorage.getItem(EXTRA_MENU_STORAGE_KEY) || '[]');
            if (!Array.isArray(parsed)) return [];
            return parsed.map(_normalizeCustomExtraItem).filter(Boolean);
        } catch {
            return [];
        }
    }

    function _saveCustomExtraItems(items) {
        const normalized = (Array.isArray(items) ? items : []).map(_normalizeCustomExtraItem).filter(Boolean);
        try {
            localStorage.setItem(EXTRA_MENU_STORAGE_KEY, JSON.stringify(normalized));
        } catch {}
        return normalized;
    }

    function _getRoleQuickAccessHrefs(role, user = _getCurrentSidebarUser()) {
        if (_isMaysternyaSidebarContext(user)) return MAYSTERNYA_QUICK_ACCESS_HREFS.slice();
        const configured = window.RoleShell?.getQuickAccessHrefs?.(role);
        const source = Array.isArray(configured) && configured.length ? configured : EXTRA_MENU_HREFS;
        return source.map(_normalizeExtraHref).filter(Boolean);
    }

    function _useRoleQuickAccessDefaults() {
        return Boolean(window.RolePreview?.getPreviewRole?.());
    }

    function _getDefaultExtraMenuItems(role) {
        const user = _getCurrentSidebarUser();
        const available = NAV_ITEMS.filter(item => item.href && item.type !== 'group' && (!role || hasAccess(item, role)) && _businessAllowsSidebarItem(item, user) && _isNavItemVisible(item, user, role));
        const byHref = new Map(available.map(item => [item.href, item]));
        return _getRoleQuickAccessHrefs(role, user)
            .map(href => byHref.get(href))
            .filter(Boolean)
            .map(item => ({
                ...item,
                custom: false,
                locked: true,
                description: item.statusKey ? '' : EXTRA_MENU_DEFAULT_DESCRIPTION
            }));
    }

    function _getExtraGroupLabel(groupKey) {
        return NAV_ITEMS.find(item => item.type === 'group' && item.key === groupKey)?.label || EXTRA_MENU_DEFAULT_DESCRIPTION;
    }

    function _getSelectableExtraMenuItems(role) {
        const user = _getCurrentSidebarUser();
        const seen = new Set();
        return NAV_ITEMS
            .filter(item => item.href && item.type !== 'group' && String(item.href).startsWith('/'))
            .filter(item => {
                const href = _normalizeExtraHref(item.href);
                if (!href || seen.has(href)) return false;
                seen.add(href);
                if (role && !hasAccess(item, role)) return false;
                if (!_businessAllowsSidebarItem(item, user)) return false;
                if (!_isNavItemVisible(item, user, role)) return false;
                return true;
            })
            .map(item => ({
                ...item,
                id: `crm_${_normalizeExtraHref(item.href).replace(/[^a-z0-9]+/gi, '_')}`,
                href: _normalizeExtraHref(item.href),
                description: item.statusKey ? '' : _getExtraGroupLabel(item.group),
                custom: true
            }));
    }

    function _hasSavedExtraMenuSelection() {
        try {
            return localStorage.getItem(EXTRA_MENU_STORAGE_KEY) !== null;
        } catch {
            return false;
        }
    }

    function _getSavedExtraMenuHrefs() {
        return _readCustomExtraItems()
            .filter(item => !item.hidden)
            .map(item => _normalizeExtraHref(item.href))
            .filter(Boolean);
    }

    function _saveExtraMenuSelection(hrefs, role) {
        const selected = new Set((Array.isArray(hrefs) ? hrefs : []).map(_normalizeExtraHref).filter(Boolean));
        const selectable = _getSelectableExtraMenuItems(role);
        return _saveCustomExtraItems(selectable.filter(item => selected.has(item.href)));
    }

    function _getSelectedExtraMenuHrefs(role) {
        const saved = !_useRoleQuickAccessDefaults() && _hasSavedExtraMenuSelection()
            ? _getSavedExtraMenuHrefs()
            : _getRoleQuickAccessHrefs(role);
        const available = new Set(_getSelectableExtraMenuItems(role).map(item => item.href));
        return saved.filter(href => available.has(href));
    }

    function _getExtraMenuItems(role, includeHidden = false) {
        const byHref = new Map(_getSelectableExtraMenuItems(role).map(item => [item.href, item]));
        return _getSelectedExtraMenuHrefs(role)
            .map(href => byHref.get(href))
            .filter(item => item && (includeHidden || !item.hidden));
    }

    function _getSelectableProductivityItems(role) {
        const user = _getCurrentSidebarUser();
        return PRODUCTIVITY_QUICK_ITEMS
            .filter(item => {
                if (item.access && role && !hasAccess(item, role)) return false;
                if (!_businessAllowsSidebarItem(item, user)) return false;
                if (!_isNavItemVisible(item, user, role)) return false;
                return true;
            })
            .map(item => ({
                ...item,
                href: _normalizeExtraHref(item.href),
                custom: true
            }))
            .filter(item => item.href);
    }

    function _hasSavedProductivitySelection() {
        try {
            return localStorage.getItem(PRODUCTIVITY_MENU_STORAGE_KEY) !== null;
        } catch {
            return false;
        }
    }

    function _getSavedProductivityHrefs() {
        try {
            const parsed = JSON.parse(localStorage.getItem(PRODUCTIVITY_MENU_STORAGE_KEY) || '[]');
            if (!Array.isArray(parsed)) return [];
            return parsed.map(_normalizeExtraHref).filter(Boolean);
        } catch {
            return [];
        }
    }

    function _saveProductivitySelection(hrefs, role) {
        const available = new Set(_getSelectableProductivityItems(role).map(item => item.href));
        const selected = (Array.isArray(hrefs) ? hrefs : [])
            .map(_normalizeExtraHref)
            .filter(href => href && available.has(href));
        try {
            localStorage.setItem(PRODUCTIVITY_MENU_STORAGE_KEY, JSON.stringify(selected));
        } catch {}
        return selected;
    }

    function _getSelectedProductivityHrefs(role) {
        const saved = _hasSavedProductivitySelection()
            ? _getSavedProductivityHrefs()
            : PRODUCTIVITY_QUICK_DEFAULT_HREFS.slice();
        const available = new Set(_getSelectableProductivityItems(role).map(item => item.href));
        return saved.map(_normalizeExtraHref).filter(href => href && available.has(href));
    }

    function _getProductivityItems(role) {
        const byHref = new Map(_getSelectableProductivityItems(role).map(item => [item.href, item]));
        return _getSelectedProductivityHrefs(role)
            .map(href => byHref.get(href))
            .filter(Boolean);
    }

    function _railKeyForItem(item) {
        return `${_normalizeExtraHref(item?.href || '')}|${item?.action || ''}`;
    }

    function _findNavItemByHref(href) {
        const normalized = _normalizeExtraHref(href);
        return NAV_ITEMS.find(item => item.href && _normalizeExtraHref(item.href) === normalized);
    }

    function _railRouteCue(item) {
        const href = String(item?.href || '');
        if (href.startsWith('/certificates')) return 'реєстр / видача / пакет';
        if (href === '/sales-funnel') return 'воронка лідів';
        if (href === '/omni#accounts') return 'підключення каналів';
        if (href === '/omni') return 'комунікації';
        if (href === '/finance') return 'фінанси';
        if (href === '/center') return 'центр керування';
        return href || 'CRM';
    }

    function _railMetaForItem(item) {
        const statusText = _navStatusFor(item);
        if (statusText) return statusText;
        const href = String(item?.href || '');
        if (href === '/dashboard') return _getSidebarSummaryState();
        if (href === '/') return 'операційний таймлайн';
        if (href === '/tasks') return 'особистий фокус задач';
        if (href === '/chat') return 'командні повідомлення';
        if (href.startsWith('/certificates')) return 'сертифікати та швидка видача';
        if (href === '/omni#accounts') return 'канали та інтеграції';
        if (href === '/afisha') return 'афіша та події';
        if (href === '/customers') return 'клієнтська база';
        if (href === '/sales-funnel') return 'ліди та продажі';
        if (href === '/staff') return 'графік команди';
        if (href === '/warehouse') return 'складські операції';
        return item?.description || _getExtraGroupLabel(item?.group) || 'CRM сторінка';
    }

    function _railShortLabel(item) {
        const href = String(item?.href || '');
        if (RAIL_SHORT_LABEL_BY_HREF.has(href)) return RAIL_SHORT_LABEL_BY_HREF.get(href);
        const raw = String(item?.label || item?.description || href || 'CRM').trim();
        const firstWord = raw.split(/\s+/)[0] || 'CRM';
        return firstWord.length > 7 ? `${firstWord.slice(0, 7)}.` : firstWord;
    }

    function _railKindLabel(kind) {
        if (kind === 'favorite') return 'обране';
        if (kind === 'primary') return 'маршрут';
        return 'розділ';
    }

    function _railPrimaryItems(role, user = _getCurrentSidebarUser()) {
        return UTILITY_RAIL_PRIMARY_HREFS
            .map(_findNavItemByHref)
            .filter(Boolean)
            .filter(item => (!role || hasAccess(item, role)) && _businessAllowsSidebarItem(item, user) && _isNavItemVisible(item, user, role));
    }

    function _railFavoriteItems(role, usedKeys = new Set()) {
        const seen = new Set(usedKeys);
        const favorites = [];
        _getExtraMenuItems(role).forEach(item => {
            const key = _railKeyForItem(item);
            if (!key || seen.has(key)) return;
            if (item.href && !String(item.href).startsWith('/')) return;
            seen.add(key);
            favorites.push(item);
        });
        return favorites.slice(0, UTILITY_RAIL_MAX_FAVORITES);
    }

    function _railFlyoutGroups(role, currentPath, currentHash, usedKeys = new Set()) {
        const user = _getCurrentSidebarUser();
        return UTILITY_RAIL_CONTEXT_GROUPS.map(groupKey => {
            const group = NAV_ITEMS.find(item => item.type === 'group' && item.key === groupKey);
            if (!group) return null;
            const children = NAV_ITEMS
                .filter(item => item.href && item.group === groupKey)
                .filter(item => {
                    if (role && !hasAccess(item, role)) return false;
                    if (!_businessAllowsSidebarItem(item, user)) return false;
                    if (!_isNavItemVisible(item, user, role)) return false;
                    const href = String(item.href || '');
                    if (!href.startsWith('/') && !href.startsWith('#')) return false;
                    return !usedKeys.has(_railKeyForItem(item));
                })
                .slice(0, UTILITY_RAIL_MAX_GROUP_LINKS);
            if (!children.length) return null;
            return {
                ...group,
                children,
                active: children.some(item => _isSidebarItemActive(item, currentPath, currentHash))
            };
        }).filter(Boolean);
    }

    function _buildUtilityRailModel(role, currentPath, currentHash) {
        const primary = _railPrimaryItems(role);
        const used = new Set(primary.map(_railKeyForItem));
        const favorites = _railFavoriteItems(role, used);
        favorites.forEach(item => used.add(_railKeyForItem(item)));
        const groups = _railFlyoutGroups(role, currentPath, currentHash, used);
        return { favorites, primary, groups };
    }

    function _isExtraMenuEditorOpen() {
        try {
            return localStorage.getItem(EXTRA_MENU_EDIT_STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    }

    function _setExtraMenuEditorOpen(open) {
        try {
            localStorage.setItem(EXTRA_MENU_EDIT_STORAGE_KEY, open ? 'true' : 'false');
        } catch {}
    }

    function _isExtraMenuCollapsed() {
        try {
            return localStorage.getItem(EXTRA_MENU_COLLAPSED_STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    }

    function _setExtraMenuCollapsed(collapsed) {
        try {
            localStorage.setItem(EXTRA_MENU_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false');
        } catch {}
    }

    function _isProductivityEditorOpen() {
        try {
            return localStorage.getItem(PRODUCTIVITY_MENU_EDIT_STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    }

    function _setProductivityEditorOpen(open) {
        try {
            localStorage.setItem(PRODUCTIVITY_MENU_EDIT_STORAGE_KEY, open ? 'true' : 'false');
        } catch {}
    }

    function _isProductivityCollapsed() {
        try {
            return localStorage.getItem(PRODUCTIVITY_MENU_COLLAPSED_STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    }

    function _setProductivityCollapsed(collapsed) {
        try {
            localStorage.setItem(PRODUCTIVITY_MENU_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false');
        } catch {}
    }

    function _isSidebarCurrencySignalEnabled() {
        try {
            return localStorage.getItem(SIDEBAR_CURRENCY_SIGNAL_STORAGE_KEY) !== 'false';
        } catch {
            return true;
        }
    }

    function _setSidebarCurrencySignalEnabled(enabled) {
        try {
            localStorage.setItem(SIDEBAR_CURRENCY_SIGNAL_STORAGE_KEY, enabled ? 'true' : 'false');
        } catch {}
        _state.identityMetaLoadedAt = 0;
        _state.identityMetaDetails.currency = null;
    }

    function _insertSidebarSectionAfter(sidebar, section, anchor) {
        if (!sidebar || !section || !anchor || anchor.parentElement !== sidebar) return;
        if (section.previousElementSibling === anchor) return;
        sidebar.insertBefore(section, anchor.nextSibling);
    }

    function _removeSidebarTodayDock() {
        document.getElementById('sidebarTodayDock')?.remove();
    }

    function _syncSidebarSectionOrder(sidebar, links) {
        if (!sidebar || !links) return;
        const deck = document.getElementById('sidebarCommandDeck');
        const extras = document.getElementById('sidebarDesignExtras');
        const productivity = document.getElementById('sidebarProductivityQuick');
        _removeSidebarTodayDock();

        if (deck && deck.parentElement !== sidebar) sidebar.insertBefore(deck, links);
        if (extras && extras.parentElement !== sidebar) sidebar.insertBefore(extras, links);
        if (productivity && productivity.parentElement !== sidebar) sidebar.insertBefore(productivity, links);

        if (deck) sidebar.insertBefore(deck, links);
        if (extras) {
            if (deck) _insertSidebarSectionAfter(sidebar, extras, deck);
            else sidebar.insertBefore(extras, links);
        }
        if (productivity) {
            if (extras) _insertSidebarSectionAfter(sidebar, productivity, extras);
            else if (deck) _insertSidebarSectionAfter(sidebar, productivity, deck);
            else sidebar.insertBefore(productivity, links);
        }
    }

    function _getExtraIconOptions() {
        return [
            ['crm', 'CRM'],
            ['dashboard', 'Дашборд'],
            ['calendar', 'Календар'],
            ['task', 'Задачі'],
            ['chat', 'Чат'],
            ['mail', 'Комунікації'],
            ['funnel', 'Ліди'],
            ['finance', 'Фінанси'],
            ['analytics', 'Фінанси та аналітика'],
            ['warehouse', 'Склад'],
            ['users', 'Клієнти'],
            ['training', 'Навчання'],
            ['content', 'Контент'],
            ['sound', 'Звук'],
            ['system', 'Система'],
            ['ai', 'AI']
        ];
    }

    function _renderExtraMenuLink(item, currentPath, currentHash, options = {}) {
        const isActive = _isSidebarItemActive(item, currentPath, currentHash);
        const statusText = _navStatusFor(item);
        const badgeType = _badgeTypeFor(item);
        const badgeClass = badgeType === 'alerts' ? ' sidebar-design-extra-badge alert' : ' sidebar-design-extra-badge';
        const description = item.statusKey
            ? `<small data-sidebar-status-key="${_escAttr(item.statusKey)}"${statusText ? '' : ' hidden'}>${_escAttr(statusText || '')}</small>`
            : `<small>${_escAttr(item.description || EXTRA_MENU_DEFAULT_DESCRIPTION)}</small>`;
        const body = `
            ${_renderIcon(item.icon, 'sidebar-design-extra-icon')}
            <span class="sidebar-design-extra-copy">
                <span>${_escAttr(item.label)}</span>
                ${description}
            </span>
            ${badgeType ? `<span class="${badgeClass.trim()}" data-badge-type="${badgeType}" style="display:none"></span>` : '<span class="sidebar-design-extra-open" aria-hidden="true">›</span>'}`;
        const targetAttrs = _isExternalExtraHref(item.href) ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a class="sidebar-design-extra-link${isActive ? ' active' : ''}" href="${_escAttr(item.href)}"${targetAttrs}>
            ${body}
        </a>`;
    }

    function _renderProductivityEditor(selectableItems, selectedHrefs) {
        const selected = new Set(selectedHrefs);
        const selectedCount = selectableItems.filter(item => selected.has(item.href)).length;
        const pickerHtml = selectableItems.length ? selectableItems.map(item => {
            const checked = selected.has(item.href);
            const meta = item.description || item.href;
            const searchText = `${item.label || ''} ${meta || ''} ${item.href || ''}`.toLowerCase();
            return `<label class="sidebar-extra-check" data-sidebar-productivity-row data-sidebar-productivity-search-text="${_escAttr(searchText)}">
                <input type="checkbox" data-sidebar-productivity-page value="${_escAttr(item.href)}"${checked ? ' checked' : ''}>
                <span class="sidebar-extra-checkmark" aria-hidden="true"></span>
                <span class="sidebar-extra-check-copy">
                    <b>${_escAttr(item.label)}</b>
                    <small>${_escAttr(meta)}</small>
                </span>
            </label>`;
        }).join('') : '<div class="sidebar-extra-empty">Для цієї ролі немає доступних особистих сторінок.</div>';
        return `<div class="sidebar-extra-editor sidebar-productivity-editor" data-sidebar-productivity-editor>
            <div class="sidebar-extra-editor-title">
                <span>Особисті сторінки</span>
                <small data-sidebar-productivity-count>${selectedCount} вибрано</small>
            </div>
            <div class="sidebar-extra-editor-tools">
                <input type="search" class="sidebar-extra-search" data-sidebar-productivity-search placeholder="Знайти особисту сторінку..." aria-label="Знайти особисту сторінку">
            </div>
            <div class="sidebar-extra-picker" data-sidebar-productivity-picker>
                ${pickerHtml}
            </div>
            <div class="sidebar-extra-form-actions">
                <button type="button" class="sidebar-extra-save" data-sidebar-productivity-save>Зберегти</button>
            </div>
        </div>`;
    }

    function _renderProductivityQuickBlock(currentPath, currentHash, options = {}) {
        const items = Array.isArray(options.items) ? options.items : [];
        const quickLinks = items
            .map(item => _renderExtraMenuLink(item, currentPath, currentHash))
            .join('');
        const listHidden = Boolean(options.listHidden);
        const editorOpen = Boolean(options.editorOpen);
        const selectedHrefs = Array.isArray(options.selectedHrefs) ? options.selectedHrefs : [];
        const selectableItems = Array.isArray(options.selectableItems) ? options.selectableItems : [];
        return `
            <div class="sidebar-design-extras-head-row sidebar-productivity-head-row">
                <button type="button" class="sidebar-design-extras-head sidebar-productivity-head" data-sidebar-productivity-toggle-section aria-expanded="${listHidden ? 'false' : 'true'}">
                    <span class="sidebar-design-extras-dot" aria-hidden="true"></span>
                    <span class="sidebar-design-extras-copy">
                        <span class="sidebar-design-extras-title">Особисте</span>
                    </span>
                    <span class="sidebar-design-extras-chevron" aria-hidden="true">${listHidden ? '⌄' : '⌃'}</span>
                </button>
                <button type="button" class="sidebar-design-extras-manage" data-sidebar-productivity-toggle-editor aria-expanded="${editorOpen ? 'true' : 'false'}" aria-label="${editorOpen ? 'Завершити налаштування особистого блоку' : 'Налаштувати особисте'}" title="${editorOpen ? 'Готово' : 'Налаштувати особисте'}">
                    <span class="sidebar-design-extras-gear" aria-hidden="true">⚙</span>
                    <span class="sidebar-design-extras-manage-text">${editorOpen ? 'Готово' : 'Редагувати'}</span>
                </button>
            </div>
            <div class="sidebar-design-extra-list sidebar-productivity-list"${listHidden ? ' hidden' : ''}>
                ${quickLinks || '<div class="sidebar-design-extra-empty">Нічого не вибрано. Натисни шестерню і додай потрібні входи.</div>'}
            </div>
            ${editorOpen ? _renderProductivityEditor(selectableItems, selectedHrefs) : ''}`;
    }

    function _updateProductivityEditorCount(productivity) {
        const count = productivity?.querySelectorAll('[data-sidebar-productivity-page]:checked').length || 0;
        const counter = productivity?.querySelector('[data-sidebar-productivity-count]');
        if (counter) counter.textContent = `${count} вибрано`;
    }

    function _applyProductivityEditorFilter(productivity) {
        const query = String(productivity?.querySelector('[data-sidebar-productivity-search]')?.value || '').trim().toLowerCase();
        productivity?.querySelectorAll('[data-sidebar-productivity-row]').forEach(row => {
            const haystack = row.dataset.sidebarProductivitySearchText || '';
            row.hidden = Boolean(query && !haystack.includes(query));
        });
    }

    function _bindProductivityQuickBlock(productivity) {
        if (!productivity) return;
        const sectionToggle = productivity.querySelector('[data-sidebar-productivity-toggle-section]');
        if (sectionToggle && sectionToggle.dataset.sidebarProductivitySectionBound !== 'true') {
            sectionToggle.dataset.sidebarProductivitySectionBound = 'true';
            sectionToggle.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const editorWasOpen = _isProductivityEditorOpen();
                if (editorWasOpen) {
                    _setProductivityEditorOpen(false);
                    _setProductivityCollapsed(false);
                } else {
                    const nextCollapsed = !productivity.classList.contains('is-collapsed');
                    _setProductivityCollapsed(nextCollapsed);
                }
                _ensureCommandDeck();
            });
        }

        const toggle = productivity.querySelector('[data-sidebar-productivity-toggle-editor]');
        if (toggle && toggle.dataset.sidebarProductivityToggleBound !== 'true') {
            toggle.dataset.sidebarProductivityToggleBound = 'true';
            toggle.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const nextOpen = !_isProductivityEditorOpen();
                _setProductivityEditorOpen(nextOpen);
                _setProductivityCollapsed(true);
                _ensureCommandDeck();
            });
        }

        const savedUser = _getCurrentSidebarUser();
        const role = _getSidebarActiveRole(savedUser);
        const getCheckedHrefs = () => [...productivity.querySelectorAll('[data-sidebar-productivity-page]:checked')].map(input => input.value);
        const saveCurrentCheckboxes = () => {
            _saveProductivitySelection(getCheckedHrefs(), role);
            _setProductivityEditorOpen(false);
            _setProductivityCollapsed(true);
            _ensureCommandDeck();
        };

        const search = productivity.querySelector('[data-sidebar-productivity-search]');
        if (search && search.dataset.sidebarProductivitySearchBound !== 'true') {
            search.dataset.sidebarProductivitySearchBound = 'true';
            search.addEventListener('input', () => _applyProductivityEditorFilter(productivity));
        }

        productivity.querySelectorAll('[data-sidebar-productivity-page]').forEach((input) => {
            if (input.dataset.sidebarProductivityPageBound === 'true') return;
            input.dataset.sidebarProductivityPageBound = 'true';
            input.addEventListener('change', () => _updateProductivityEditorCount(productivity));
        });

        const save = productivity.querySelector('[data-sidebar-productivity-save]');
        if (save && save.dataset.sidebarProductivitySaveBound !== 'true') {
            save.dataset.sidebarProductivitySaveBound = 'true';
            save.addEventListener('click', saveCurrentCheckboxes);
        }
    }

    function _renderExtraMenuEditor(selectableItems, selectedHrefs) {
        const selected = new Set(selectedHrefs);
        const selectedCount = selectableItems.filter(item => selected.has(item.href)).length;
        const currencySignalEnabled = _isSidebarCurrencySignalEnabled();
        const pickerHtml = selectableItems.length ? selectableItems.map(item => {
            const checked = selected.has(item.href);
            const meta = item.description || item.href;
            const searchText = `${item.label || ''} ${meta || ''} ${item.href || ''}`.toLowerCase();
            return `<label class="sidebar-extra-check" data-sidebar-extra-row data-sidebar-extra-search-text="${_escAttr(searchText)}">
                <input type="checkbox" data-sidebar-extra-page value="${_escAttr(item.href)}"${checked ? ' checked' : ''}>
                <span class="sidebar-extra-checkmark" aria-hidden="true"></span>
                <span class="sidebar-extra-check-copy">
                    <b>${_escAttr(item.label)}</b>
                    <small>${_escAttr(meta)}</small>
                </span>
            </label>`;
        }).join('') : '<div class="sidebar-extra-empty">Для цієї ролі немає доступних CRM-сторінок.</div>';
        return `<div class="sidebar-extra-editor" data-sidebar-extra-editor>
            <div class="sidebar-extra-editor-title">
                <span>Сторінки обраного</span>
                <small data-sidebar-extra-count>${selectedCount} вибрано</small>
            </div>
            <div class="sidebar-extra-editor-tools">
                <input type="search" class="sidebar-extra-search" data-sidebar-extra-search placeholder="Знайти сторінку CRM..." aria-label="Знайти сторінку обраного">
            </div>
            <div class="sidebar-widget-settings" data-sidebar-widget-settings>
                <div class="sidebar-widget-settings-head">
                    <span>Налаштування віджетів</span>
                    <small>профіль sidebar</small>
                </div>
                <label class="sidebar-extra-preference">
                    <input type="checkbox" data-sidebar-currency-signal${currencySignalEnabled ? ' checked' : ''}>
                    <span class="sidebar-extra-preference-mark" aria-hidden="true"></span>
                    <span class="sidebar-extra-preference-copy">
                        <b>USD у профілі</b>
                        <small>Клік по USD відкриває курси валют. Зміна застосовується після збереження.</small>
                    </span>
                </label>
            </div>
            <div class="sidebar-extra-picker" data-sidebar-extra-picker>
                ${pickerHtml}
            </div>
            <div class="sidebar-extra-form-actions">
                <button type="button" class="sidebar-extra-save" data-sidebar-extra-save>Зберегти</button>
            </div>
        </div>`;
    }

    function _updateExtraMenuEditorCount(extras) {
        const count = extras?.querySelectorAll('[data-sidebar-extra-page]:checked').length || 0;
        const counter = extras?.querySelector('[data-sidebar-extra-count]');
        if (counter) counter.textContent = `${count} вибрано`;
    }

    function _applyExtraMenuEditorFilter(extras) {
        const query = String(extras?.querySelector('[data-sidebar-extra-search]')?.value || '').trim().toLowerCase();
        extras?.querySelectorAll('[data-sidebar-extra-row]').forEach(row => {
            const haystack = row.dataset.sidebarExtraSearchText || '';
            row.hidden = Boolean(query && !haystack.includes(query));
        });
    }

    function _bindExtraMenuEditor(extras) {
        if (!extras) return;
        const sectionToggle = extras.querySelector('[data-sidebar-extra-toggle-section]');
        if (sectionToggle && sectionToggle.dataset.sidebarExtraSectionBound !== 'true') {
            sectionToggle.dataset.sidebarExtraSectionBound = 'true';
            sectionToggle.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const editorWasOpen = _isExtraMenuEditorOpen();
                if (editorWasOpen) {
                    _state.extraEditingId = '';
                    _setExtraMenuEditorOpen(false);
                    _setExtraMenuCollapsed(false);
                } else {
                    const nextCollapsed = !extras.classList.contains('is-collapsed');
                    _setExtraMenuCollapsed(nextCollapsed);
                }
                _ensureCommandDeck();
            });
        }

        const toggle = extras.querySelector('[data-sidebar-extra-toggle-editor]');
        if (toggle && toggle.dataset.sidebarExtraToggleBound !== 'true') {
            toggle.dataset.sidebarExtraToggleBound = 'true';
            toggle.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const nextOpen = !_isExtraMenuEditorOpen();
                _setExtraMenuEditorOpen(nextOpen);
                _setExtraMenuCollapsed(true);
                if (!nextOpen) _state.extraEditingId = '';
                _ensureCommandDeck();
            });
        }

        const savedUser = _getCurrentSidebarUser();
        const role = _getSidebarActiveRole(savedUser);
        const getCheckedHrefs = () => [...extras.querySelectorAll('[data-sidebar-extra-page]:checked')].map(input => input.value);
        const saveCurrentCheckboxes = () => {
            const checkedHrefs = getCheckedHrefs();
            const currencySignal = extras.querySelector('[data-sidebar-currency-signal]');
            if (currencySignal) _setSidebarCurrencySignalEnabled(currencySignal.checked);
            _saveExtraMenuSelection(checkedHrefs, role);
            _state.extraEditingId = '';
            _setExtraMenuEditorOpen(false);
            _setExtraMenuCollapsed(true);
            _ensureCommandDeck();
        };

        const search = extras.querySelector('[data-sidebar-extra-search]');
        if (search && search.dataset.sidebarExtraSearchBound !== 'true') {
            search.dataset.sidebarExtraSearchBound = 'true';
            search.addEventListener('input', () => _applyExtraMenuEditorFilter(extras));
        }

        const currencySignal = extras.querySelector('[data-sidebar-currency-signal]');
        if (currencySignal && currencySignal.dataset.sidebarCurrencySignalBound !== 'true') {
            currencySignal.dataset.sidebarCurrencySignalBound = 'true';
            currencySignal.addEventListener('change', () => {
                extras.classList.add('has-widget-settings-dirty');
            });
        }

        extras.querySelectorAll('[data-sidebar-extra-page]').forEach((input) => {
            if (input.dataset.sidebarExtraPageBound === 'true') return;
            input.dataset.sidebarExtraPageBound = 'true';
            input.addEventListener('change', () => _updateExtraMenuEditorCount(extras));
        });

        const save = extras.querySelector('[data-sidebar-extra-save]');
        if (save && save.dataset.sidebarExtraSaveBound !== 'true') {
            save.dataset.sidebarExtraSaveBound = 'true';
            save.addEventListener('click', saveCurrentCheckboxes);
        }
    }

    // ═══ RENDER ═══════════════════════════════════════════════════
    function render(containerSelector, options = {}) {
        const container = document.querySelector(containerSelector || '#sidebarNav .sidebar-links');
        if (!container) return;
        const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        const savedUser = _getCurrentSidebarUser();
        const role = _getSidebarActiveRole(savedUser);

        let currentGroupKey = null;
        let html = '';

        for (const item of NAV_ITEMS) {
            // ── Group header ──────────────────────────────────────
            if (item.type === 'group') {
                // Close previous group
                if (currentGroupKey !== null && currentGroupKey !== '__skip__' && currentGroupKey !== '__skip_today__') {
                    html += '</div></div></div>'; // inner + items + group
                }
                currentGroupKey = item.key;
                if (item.key === 'today') {
                    currentGroupKey = '__skip_today__';
                    continue;
                }

                // Check if group has accessible children
                const hasChildren = NAV_ITEMS.some(c =>
                    c.group === item.key && !c.quickAccessOnly && (!role || hasAccess(c, role)) && _businessAllowsSidebarItem(c, savedUser) && _isNavItemVisible(c, savedUser, role)
                );
                if (!hasChildren) { currentGroupKey = '__skip__'; continue; }

                // Mark group that contains the current page without forcing it open.
                const hasActive = NAV_ITEMS.some(c => {
                    if (c.group !== item.key || c.noActive || c.isHashLink || c.quickAccessOnly || !_businessAllowsSidebarItem(c, savedUser) || !_isNavItemVisible(c, savedUser, role)) return false;
                    const cBase = c.href.split('#')[0];
                    return currentPath === cBase || (cBase !== '/' && currentPath.startsWith(cBase));
                });
                const finalOpen = _isGroupOpen(item.key, item.defaultOpen, role, hasActive);

                html += `
<div class="sidebar-group${hasActive ? ' has-active' : ''}" data-group-key="${item.key}">
  <button type="button" class="sidebar-group-header${finalOpen ? ' open' : ''}${hasActive ? ' has-active' : ''}"
          onclick="Sidebar.toggleGroup('${item.key}', this)"
          title="${item.label}"
          aria-expanded="${finalOpen ? 'true' : 'false'}"
          aria-controls="sidebarGroupItems-${item.key}">
    ${_renderIcon(item.icon)}
    <span class="nav-text sidebar-group-label">${item.label}</span>
    <span class="sidebar-group-signal" id="sidebarGroupSignal-${item.key}" aria-hidden="true"></span>
    ${_renderGroupChevron()}
  </button>
  <div class="sidebar-group-items${finalOpen ? ' open' : ''}" id="sidebarGroupItems-${item.key}" aria-hidden="${finalOpen ? 'false' : 'true'}"${finalOpen ? '' : ' inert'}>
    <div class="sidebar-group-inner">`;
                continue;
            }

            // Skip if group is blocked
            if (currentGroupKey === '__skip__' || currentGroupKey === '__skip_today__') continue;
            if (item.quickAccessOnly) continue;
            if (!_businessAllowsSidebarItem(item, savedUser)) continue;
            if (!_isNavItemVisible(item, savedUser, role)) continue;

            // ── Skip no access ────────────────────────────────────
            if (role && !hasAccess(item, role)) continue;

            // ── Render nav-link ───────────────────────────────────
            const currentHash = location.hash.replace('#', '');
            const isActive = _isSidebarItemActive(item, currentPath, currentHash);

            // E9 FIX: simplified onclick
            let onclickAttr = '';
            if (item.action) {
                onclickAttr = ` onclick="event.preventDefault();if(typeof ${item.action}==='function')${item.action}();"`;
            }

            const badgeType = _badgeTypeFor(item);
            const badgeClass = badgeType === 'alerts' ? ' nav-badge alert' : ' nav-badge';

            const statusText = _navStatusFor(item);
            const itemHref = _sidebarHrefForBusinessItem(item, savedUser);
            const legacyClass = item.navLegacy ? ' nav-link--legacy' : '';
            const legacyAttr = item.navLegacy ? ' data-sidebar-legacy="hr"' : '';
            const bucketAttr = item.hrTeamBucket ? ` data-hr-team-bucket="${_escAttr(item.hrTeamBucket)}"` : '';
            html += `<a href="${_escAttr(itemHref)}" class="nav-link${legacyClass}${isActive ? ' active' : ''}" data-page-access="${item.pageAccess || item.href}"${legacyAttr}${bucketAttr}${isActive ? ' aria-current="page"' : ''}${onclickAttr}>
  ${_renderIcon(item.icon)}
  <span class="nav-copy">
    <span class="nav-text">${item.label}</span>
    ${item.statusKey ? `<span class="nav-status" data-sidebar-status-key="${item.statusKey}"${statusText ? '' : ' hidden'}>${statusText || ''}</span>` : ''}
  </span>
  ${badgeType ? `<span class="${badgeClass.trim()}" data-badge-type="${badgeType}" style="display:none"></span>` : ''}
</a>`;
        }

        // Close last group
        if (currentGroupKey && currentGroupKey !== '__skip__' && currentGroupKey !== '__skip_today__') {
            html += '</div></div></div>';
        }

        container.innerHTML = html;
        container.classList.add('rendered');

        _ensureAuroraLayer();
        _ensureCommandDeck();
        _ensureSidebarMiniRail(role, currentPath, location.hash.replace('#', ''));
        _removeSidebarTodayDock();
        _syncGroupSignals();
        _ensureActiveIndicator();
        _syncSidebarGroupPanelStates(container);
        _initCollapsedRailInteractions(document.getElementById('sidebarNav'));
        _initSpotlight();
        _initRipple();
        _initMagnetic();
        if (options.refreshOperational !== false) _refreshSidebarOperationalWidgets();
        _queueActiveIndicatorUpdate();
    }

    function _refreshSidebarOperationalWidgets() {
        _fetchLiveBadges();
        _refreshTaskMiniWidget();
        _refreshFunnelWidget();
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
    function _setSidebarGroupPanelState(btn, items, expanded) {
        if (!btn || !items) return;
        items.classList.toggle('open', expanded);
        btn.classList.toggle('open', expanded);
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        items.setAttribute('aria-hidden', expanded ? 'false' : 'true');
        if (expanded) {
            items.removeAttribute('inert');
        } else {
            items.setAttribute('inert', '');
        }
        try {
            items.inert = !expanded;
        } catch {}
    }

    function _syncSidebarGroupPanelStates(root = document) {
        root.querySelectorAll('.sidebar-group').forEach(group => {
            const btn = group.querySelector('.sidebar-group-header');
            const items = group.querySelector('.sidebar-group-items');
            if (!btn || !items) return;
            _setSidebarGroupPanelState(btn, items, items.classList.contains('open'));
        });
    }

    function toggleGroup(key, btn) {
        if (!btn) return;
        const group = btn.closest('.sidebar-group');
        if (!group) return;
        const items = group.querySelector('.sidebar-group-items');
        if (!items) return;
        const isOpen = items.classList.contains('open');
        _setSidebarGroupPanelState(btn, items, !isOpen);
        _saveGroupStateFromDom(document.getElementById('sidebarNav'));
        _queueActiveIndicatorUpdate();
        setTimeout(_queueActiveIndicatorUpdate, 260);
    }

    // ═══ ACCESS CHECK ══════════════════════════════════════════════
    function hasAccess(item, role) {
        // v39.10: Creator always sees everything
        const user = _getCurrentSidebarUser();
        const previewRole = window.RolePreview?.getPreviewRole?.() || '';
        const roles = new Set([role]);
        if (!previewRole) {
            if (Array.isArray(user?.roles)) user.roles.forEach(value => roles.add(value));
            if (Array.isArray(user?.extraRoles)) user.extraRoles.forEach(value => roles.add(value));
            if (Array.isArray(user?.extra_roles)) user.extra_roles.forEach(value => roles.add(value));
        }
        if (!previewRole && _isMaysternyaSidebarContext(user) && MAYSTERNYA_ACCESS_OVERRIDES.has(item?.access)) return true;
        if (roles.has('creator')) return true;
        const access = SIDEBAR_ACCESS[item.access];
        if (access === true) return true;
        if (!access) return false;
        return Array.from(roles).some(value => access.includes(value));
    }

    const BUSINESS_MODULE_ACCESS_MAP = Object.freeze({
        timeline: 'timeline',
        maysternya_doli: 'timeline',
        tasks: 'tasks',
        chat: 'chat',
        customers: 'customers',
        leads: 'leads',
        omni: 'omni',
        reports: 'reports',
        finance: 'finance',
        analytics: 'finance',
        copilot: 'copilot',
        staff: 'staff',
        hr: 'hr',
        hr_page: 'hr',
        schedule_daily: 'staff',
        training: 'training',
        programs: 'programs',
        content: 'content',
        graduation: 'graduation',
        art: 'art',
        sound: 'sound',
        afisha: 'afisha',
        certificates: 'certificates',
        guardian_ops: 'guardian',
        center: 'center',
        warehouse: 'warehouse',
        demo: 'demo',
        settings: 'settings'
    });

    function _businessModuleForItem(item = {}) {
        if (item.businessModule) return item.businessModule;
        if (item.href === '/dashboard') return 'dashboard';
        if (item.href === '/game' || item.href === '/shop' || item.href === '/quiz') return 'game';
        if (item.href === '/kleshnya') return 'kleshnya';
        return BUSINESS_MODULE_ACCESS_MAP[item.access] || null;
    }

    function _sidebarUserHasCreator(user = _getCurrentSidebarUser()) {
        const roles = [user?.role, user?.account_role, user?.accountRole];
        if (Array.isArray(user?.roles)) roles.push(...user.roles);
        if (Array.isArray(user?.extraRoles)) roles.push(...user.extraRoles);
        if (Array.isArray(user?.extra_roles)) roles.push(...user.extra_roles);
        return roles.filter(Boolean).map(value => String(value).trim()).includes('creator');
    }

    function _isMaysternyaSidebarContext(user = _getCurrentSidebarUser()) {
        const api = window.CrmBusinessContext;
        if (api?.current) return api.current(user) === 'maysternya_doli';
        if (!_sidebarUserHasCreator(user)) return false;
        const rawDefault = user?.defaultBusinessContext || user?.default_business_context || '';
        return String(rawDefault).trim().toLowerCase() === 'maysternya_doli';
    }

    function _isMaysternyaSidebarHrefAllowed(item = {}) {
        const href = _normalizeExtraHref(item.href || '');
        return href ? MAYSTERNYA_SIDEBAR_HREFS.has(href) : true;
    }

    function _businessAllowsSidebarItem(item = {}, user = _getCurrentSidebarUser()) {
        const moduleId = _businessModuleForItem(item);
        const api = window.CrmBusinessContext;
        if (_isMaysternyaSidebarContext(user) && !_isMaysternyaSidebarHrefAllowed(item)) return false;
        if (!moduleId || !api?.current || !api?.hasModule) return true;
        const current = api.current(user);
        const creatorSurface = _sidebarUserHasCreator(user) && !window.RolePreview?.getPreviewRole?.();
        if (moduleId === 'timeline') {
            if (item.href === '/' && current === 'maysternya_doli') return false;
            if (item.href === '/maysternya-doli' && current !== 'maysternya_doli') return creatorSurface;
        }
        if (creatorSurface && current !== 'maysternya_doli') return true;
        return api.hasModule(current, moduleId);
    }

    function _sidebarHrefForBusinessItem(item = {}, user = _getCurrentSidebarUser()) {
        const href = String(item.href || '');
        if (href !== '/') return href;
        const api = window.CrmBusinessContext;
        const current = api?.current?.(user);
        if (!current || current === 'event_genix' || current === 'maysternya_doli') return href;
        if (!api.hasModule?.(current, 'timeline')) return href;
        return `/?businessContext=${encodeURIComponent(current)}`;
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

    function _formatTaskWidgetCount(value) {
        const count = Number(value || 0);
        if (!Number.isFinite(count) || count <= 0) return '0';
        return count > 99 ? '99+' : String(Math.floor(count));
    }

    function _toSidebarCounterValue(value) {
        const count = Number(value || 0);
        return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    }

    function _emptyBusinessLiveCounters() {
        return {
            leads: { new: 0, hot: 0 },
            tasks: { active: 0, overdue: 0 },
            alerts: { active: 0 }
        };
    }

    function _sidebarScopedApiUrl(url) {
        const apiUrl = window.CrmBusinessContext?.apiUrl;
        return typeof apiUrl === 'function' ? apiUrl(url) : url;
    }

    function _sidebarAuthHeaders(token = localStorage.getItem('pzp_token')) {
        if (typeof getAuthHeaders === 'function') return getAuthHeaders(false);
        return token ? { 'Authorization': 'Bearer ' + token } : {};
    }

    async function _fetchBusinessLiveCounters(authHeaders = null) {
        const token = localStorage.getItem('pzp_token');
        if (!token) return null;
        const url = _sidebarScopedApiUrl('/api/business/live-counters');
        if (_state.liveCountersPromise && _state.liveCountersUrl === url) return _state.liveCountersPromise;
        const headers = authHeaders || _sidebarAuthHeaders(token);
        const request = fetch(url, { headers })
            .then(response => response.ok ? response.json() : null)
            .then(payload => payload?.success ? payload : null)
            .catch(() => null)
            .finally(() => {
                if (_state.liveCountersPromise === request) {
                    _state.liveCountersPromise = null;
                    _state.liveCountersUrl = '';
                }
            });
        _state.liveCountersPromise = request;
        _state.liveCountersUrl = url;
        return request;
    }

    function _businessLiveCounterScope(payload = {}) {
        const safePayload = payload || {};
        const user = _getCurrentSidebarUser();
        const apiScope = window.CrmBusinessContext?.scope?.(user);
        const scope = safePayload.scope || apiScope || {};
        const selectedContexts = Array.isArray(scope.selectedContexts) && scope.selectedContexts.length
            ? scope.selectedContexts
            : [scope.activeContext || window.CrmBusinessContext?.current?.(user) || 'event_genix'];
        return {
            mode: scope.mode || 'single',
            activeContext: scope.activeContext || selectedContexts[0] || 'event_genix',
            selectedContexts,
            readOnly: scope.readOnly === true,
            canWrite: scope.canWrite !== false
        };
    }

    function _businessLiveCounterBucket(payload = {}) {
        const safePayload = payload || {};
        const counters = safePayload.counters || {};
        const scope = _businessLiveCounterScope(safePayload);
        if (scope.mode === 'multi' || scope.mode === 'all') return counters.total || _emptyBusinessLiveCounters();
        return counters.byBusiness?.[scope.activeContext] || counters.total || _emptyBusinessLiveCounters();
    }

    function _businessScopeCounterLabel(scope = {}) {
        const mode = scope.mode || 'single';
        if (mode === 'all') return 'усі доступні бізнеси, огляд без змін';
        if (mode === 'multi') {
            const count = Array.isArray(scope.selectedContexts) ? scope.selectedContexts.length : 0;
            return `${count || 'кілька'} вибрані бізнеси, огляд без змін`;
        }
        const user = _getCurrentSidebarUser();
        const state = window.CrmBusinessContext?.state?.(user);
        const active = scope.activeContext || window.CrmBusinessContext?.current?.(user);
        const context = state?.availableBusinesses?.find(ctx => (ctx.key || ctx.id) === active);
        const label = context ? _sidebarBusinessFullLabel(context) : '';
        return label ? `активний бізнес: ${label}` : 'активний бізнес';
    }

    function _sidebarKyivToday() {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Kyiv',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date());
        const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${map.year}-${map.month}-${map.day}`;
    }

    function _sidebarTaskDateOnly(value) {
        if (!value) return '';
        const raw = String(value);
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Kyiv',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(d);
        const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${map.year}-${map.month}-${map.day}`;
    }

    function _sidebarTaskWorkloadDate(task = {}) {
        return _sidebarTaskDateOnly(
            task.scheduledStartAt ||
            task.scheduled_start_at ||
            task.schedule?.startAt ||
            task.date ||
            task.deadline ||
            task.remindAt ||
            task.remind_at
        );
    }

    function _isSidebarTaskTodayOrUndated(task = {}, today = _sidebarKyivToday()) {
        const date = _sidebarTaskWorkloadDate(task);
        return !date || date === today;
    }

    function _isSidebarTaskOpen(task = {}) {
        return !['done', 'cancelled', 'archived'].includes(String(task.status || 'todo').toLowerCase());
    }

    function _isSidebarTaskCompletedToday(task = {}, today = _sidebarKyivToday()) {
        if (task.status !== 'done') return false;
        const completedDate = _sidebarTaskDateOnly(task.completedAt || task.completed_at);
        return Boolean(completedDate && completedDate === today);
    }

    function _sidebarTaskQuickCountsFromCabinet(cabinet = {}) {
        const stats = cabinet?.stats || {};
        const quick = stats.taskQuick || stats.tasksQuick || {};
        const completed = Number(quick.completedToday ?? stats.todayDone ?? quick.completed ?? stats.completedCount ?? stats.doneCount ?? 0);
        const allOpen = Array.isArray(cabinet?.all) ? cabinet.all.filter(_isSidebarTaskOpen).length : null;
        const open = Number(
            quick.sidebarOpenWorkload ??
            quick.openTotal ??
            quick.open ??
            stats.openTaskCount ??
            stats.activeOpenCount ??
            allOpen ??
            quick.remaining ??
            stats.todayWorkloadCount ??
            stats.todayPlanned ??
            0
        );
        const overdue = Number(stats.overdueCount ?? quick.overdueCarryover ?? 0)
            || (Array.isArray(cabinet?.overdue) ? cabinet.overdue.filter(_isSidebarTaskOpen).length : 0);
        return {
            completed: Number.isFinite(completed) && completed > 0 ? Math.floor(completed) : 0,
            open: Number.isFinite(open) && open > 0 ? Math.floor(open) : 0,
            remaining: Number.isFinite(open) && open > 0 ? Math.floor(open) : 0,
            overdue: Number.isFinite(overdue) && overdue > 0 ? Math.floor(overdue) : 0
        };
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

    /**
     * @typedef {'tasks'|'alerts'|'leads'} MetricKind
     * @param {MetricKind} kind
     * @param {number} count
     */
    function getMetricTone(kind, count) {
        const safeCount = Math.max(0, Number(count || 0));
        switch (kind) {
            case 'tasks':
                if (safeCount === 0) return 'neutral';
                if (safeCount <= 3) return 'success';
                if (safeCount <= 7) return 'warning';
                return 'danger';
            case 'alerts':
                if (safeCount === 0) return 'success';
                if (safeCount <= 2) return 'warning';
                return 'danger';
            case 'leads':
                if (safeCount === 0) return 'neutral';
                if (safeCount <= 5) return 'info';
                if (safeCount <= 20) return 'success';
                return 'accent';
            default:
                return safeCount > 0 ? 'info' : 'neutral';
        }
    }

    function _queueActiveIndicatorUpdate() {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_updateActiveIndicator);
        else setTimeout(_updateActiveIndicator, 0);
    }

    // ═══ COLLAPSED UTILITY RAIL PREVIEWS ═══
    function _isUtilityRailInteractionEnabled() {
        const sidebar = document.getElementById('sidebarNav');
        return Boolean(sidebar?.classList.contains('collapsed') && window.innerWidth > 768);
    }

    function _ensureRailFloat() {
        let panel = document.getElementById('sidebarRailFloat');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'sidebarRailFloat';
            panel.className = 'sidebar-rail-float';
            panel.hidden = true;
            document.body.appendChild(panel);
        }
        if (panel.dataset.sidebarRailFloatBound !== 'true') {
            panel.dataset.sidebarRailFloatBound = 'true';
            panel.addEventListener('pointerenter', _cancelRailFloatClose);
            panel.addEventListener('pointerleave', (event) => {
                if (_state.railActiveAnchor?.contains(event.relatedTarget)) return;
                if (_state.railPinned) return;
                _scheduleRailFloatClose(120);
            });
            panel.addEventListener('focusout', () => {
                setTimeout(() => {
                    if (_state.railPinned) return;
                    if (panel.contains(document.activeElement)) return;
                    if (_state.railActiveAnchor?.contains(document.activeElement)) return;
                    _closeRailFloat();
                }, 0);
            });
            panel.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    const anchor = _state.railActiveAnchor;
                    _closeRailFloat();
                    anchor?.focus?.({ preventScroll: true });
                }
            });
            panel.addEventListener('click', (event) => {
                if (event.target.closest('a[href]')) _closeRailFloat();
            });
        }
        return panel;
    }

    function _positionRailFloat(anchor, panel) {
        if (!anchor || !panel) return;
        const rect = anchor.getBoundingClientRect();
        const sidebarRect = document.getElementById('sidebarNav')?.getBoundingClientRect();
        const gap = 10;
        panel.style.left = '0px';
        panel.style.top = '0px';
        const panelRect = panel.getBoundingClientRect();
        const maxLeft = Math.max(12, window.innerWidth - panelRect.width - 12);
        const preferredLeft = Math.max(rect.right + gap, (sidebarRect?.right || 0) + 8);
        const left = Math.min(maxLeft, preferredLeft);
        const maxTop = Math.max(12, window.innerHeight - panelRect.height - 12);
        const top = Math.min(maxTop, Math.max(12, rect.top + (rect.height / 2) - (panelRect.height / 2)));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
    }

    function _renderRailPreviewPanel(anchor) {
        const title = anchor.dataset.sidebarRailTitle || anchor.getAttribute('aria-label') || 'CRM';
        const meta = anchor.dataset.sidebarRailMeta || '';
        const cue = anchor.dataset.sidebarRailCue || '';
        const kind = anchor.dataset.sidebarRailKind === 'favorite' ? 'Обране' : 'Маршрут';
        return `
            <div class="sidebar-rail-preview-head">
                <span>${_escHtml(kind)}</span>
                <strong>${_escHtml(title)}</strong>
            </div>
            ${meta ? `<p>${_escHtml(meta)}</p>` : ''}
            ${cue ? `<div class="sidebar-rail-preview-cue">${_escHtml(cue)}</div>` : ''}`;
    }

    function _renderRailFlyoutPanel(currentPath, currentHash) {
        const user = _getCurrentSidebarUser();
        const role = _getSidebarActiveRole(user);
        const { primary, favorites, groups } = _buildUtilityRailModel(role, currentPath, currentHash);
        const usedCount = primary.length + favorites.length;
        const sections = groups.map(group => {
            const links = group.children.map(item => {
                const isActive = _isSidebarItemActive(item, currentPath, currentHash);
                const onclickAttr = item.action
                    ? ` onclick="event.preventDefault();if(typeof ${item.action}==='function')${item.action}();"`
                    : '';
                const badgeType = _badgeTypeFor(item);
                const itemHref = _sidebarHrefForBusinessItem(item, user);
                return `<a href="${_escAttr(itemHref)}" class="sidebar-rail-flyout-link${isActive ? ' active' : ''}" role="menuitem"${isActive ? ' aria-current="page"' : ''}${onclickAttr}>
                    ${_renderIcon(item.icon, 'sidebar-rail-flyout-icon')}
                    <span class="sidebar-rail-flyout-copy">
                        <span>${_escHtml(item.label)}</span>
                        <small>${_escHtml(_railMetaForItem(item))}</small>
                    </span>
                    ${badgeType ? `<span class="sidebar-mini-badge sidebar-rail-flyout-badge" data-badge-type="${badgeType}" style="display:none"></span>` : ''}
                </a>`;
            }).join('');
            return `<section class="sidebar-rail-flyout-section${group.active ? ' has-active' : ''}" role="presentation">
                <div class="sidebar-rail-flyout-section-head">
                    ${_renderIcon(group.icon, 'sidebar-rail-flyout-group-icon')}
                    <span>${_escHtml(group.label)}</span>
                </div>
                <div class="sidebar-rail-flyout-links">${links}</div>
            </section>`;
        }).join('');
        return `
            <div class="sidebar-rail-flyout-head">
                <span>Контекстні розділи</span>
                <strong>CRM command rail</strong>
                <small>${_escHtml(`${usedCount} закріплено у rail, інші доступні тут`)}</small>
            </div>
            <div class="sidebar-rail-flyout-body" role="menu" aria-label="Контекстні розділи CRM">
                ${sections || '<div class="sidebar-rail-flyout-empty">Для цієї ролі немає додаткових розділів.</div>'}
            </div>`;
    }

    function _setRailActiveAnchor(anchor) {
        if (_state.railActiveAnchor && _state.railActiveAnchor !== anchor && _state.railActiveAnchor.matches?.('[data-sidebar-rail-flyout]')) {
            _state.railActiveAnchor.setAttribute('aria-expanded', 'false');
        }
        _state.railActiveAnchor = anchor;
    }

    function _showRailPreview(anchor) {
        if (!_isUtilityRailInteractionEnabled() || !anchor) return;
        _cancelRailFloatClose();
        const panel = _ensureRailFloat();
        panel.className = 'sidebar-rail-float sidebar-rail-preview';
        panel.dataset.mode = 'preview';
        panel.innerHTML = _renderRailPreviewPanel(anchor);
        panel.hidden = false;
        panel.style.visibility = 'hidden';
        _state.railPinned = false;
        _setRailActiveAnchor(anchor);
        _positionRailFloat(anchor, panel);
        panel.style.visibility = '';
    }

    function _showRailFlyout(anchor, focusFirst = false, options = {}) {
        if (!_isUtilityRailInteractionEnabled() || !anchor) return;
        _cancelRailFloatClose();
        const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        const currentHash = location.hash.replace('#', '');
        const panel = _ensureRailFloat();
        panel.className = 'sidebar-rail-float sidebar-rail-flyout';
        panel.dataset.mode = 'flyout';
        panel.innerHTML = _renderRailFlyoutPanel(currentPath, currentHash);
        panel.hidden = false;
        panel.style.visibility = 'hidden';
        anchor.setAttribute('aria-expanded', 'true');
        _state.railPinned = options.pinned === true;
        _setRailActiveAnchor(anchor);
        _positionRailFloat(anchor, panel);
        panel.style.visibility = '';
        if (focusFirst) {
            setTimeout(() => panel.querySelector('a, button')?.focus?.({ preventScroll: true }), 0);
        }
        _syncNavStatusLabels();
    }

    function _closeRailFloat() {
        _cancelRailFloatClose();
        const panel = document.getElementById('sidebarRailFloat');
        if (panel) {
            panel.hidden = true;
            panel.removeAttribute('data-mode');
        }
        if (_state.railActiveAnchor?.matches?.('[data-sidebar-rail-flyout]')) {
            _state.railActiveAnchor.setAttribute('aria-expanded', 'false');
        }
        _state.railActiveAnchor = null;
        _state.railPinned = false;
    }

    function _scheduleRailFloatClose(delay = 90) {
        _cancelRailFloatClose();
        _state.railCloseTimer = setTimeout(_closeRailFloat, delay);
    }

    function _cancelRailFloatClose() {
        if (_state.railCloseTimer) {
            clearTimeout(_state.railCloseTimer);
            _state.railCloseTimer = null;
        }
    }

    function _handleRailFloatDocumentScroll(event) {
        const panel = document.getElementById('sidebarRailFloat');
        if (!panel || panel.hidden) return;
        const target = event.target;
        if (panel.contains(target)) return;
        if (_state.railActiveAnchor?.contains?.(target)) return;
        const sidebar = document.getElementById('sidebarNav');
        if (sidebar?.contains?.(target)) return;
        _closeRailFloat();
    }

    function _initCollapsedRailInteractions(sidebar) {
        if (!sidebar || sidebar.dataset.sidebarRailBound === 'true') return;
        sidebar.dataset.sidebarRailBound = 'true';

        sidebar.addEventListener('pointerover', (event) => {
            const flyout = event.target.closest('[data-sidebar-rail-flyout]');
            const item = event.target.closest('[data-sidebar-rail-item]');
            const anchor = flyout || item;
            if (!anchor || !sidebar.contains(anchor)) return;
            if (flyout) _showRailFlyout(flyout);
            else _showRailPreview(item);
        });

        sidebar.addEventListener('pointerout', (event) => {
            const anchor = event.target.closest('[data-sidebar-rail-flyout], [data-sidebar-rail-item]');
            if (!anchor || !sidebar.contains(anchor) || anchor.contains(event.relatedTarget)) return;
            const panel = document.getElementById('sidebarRailFloat');
            if (panel?.contains(event.relatedTarget)) return;
            if (_state.railPinned) return;
            _scheduleRailFloatClose(panel?.dataset.mode === 'flyout' ? 140 : 70);
        });

        sidebar.addEventListener('focusin', (event) => {
            const flyout = event.target.closest('[data-sidebar-rail-flyout]');
            const item = event.target.closest('[data-sidebar-rail-item]');
            const anchor = flyout || item;
            if (!anchor || !sidebar.contains(anchor)) return;
            if (flyout) _showRailFlyout(flyout);
            else _showRailPreview(item);
        });

        sidebar.addEventListener('focusout', () => {
            setTimeout(() => {
                if (_state.railPinned) return;
                const panel = document.getElementById('sidebarRailFloat');
                if (panel?.contains(document.activeElement)) return;
                if (sidebar.contains(document.activeElement)) return;
                _closeRailFloat();
            }, 0);
        });

        sidebar.addEventListener('click', (event) => {
            const flyout = event.target.closest('[data-sidebar-rail-flyout]');
            if (flyout && sidebar.contains(flyout)) {
                event.preventDefault();
                event.stopPropagation();
                const panel = document.getElementById('sidebarRailFloat');
                if (panel && !panel.hidden && panel.dataset.mode === 'flyout' && _state.railActiveAnchor === flyout && _state.railPinned) {
                    _closeRailFloat();
                } else {
                    _showRailFlyout(flyout, false, { pinned: true });
                }
                return;
            }
            if (event.target.closest('[data-sidebar-rail-item]')) _scheduleRailFloatClose(0);
        });

        sidebar.addEventListener('keydown', (event) => {
            const flyout = event.target.closest('[data-sidebar-rail-flyout]');
            if (event.key === 'Escape') {
                _closeRailFloat();
                return;
            }
            if (!flyout || !sidebar.contains(flyout)) return;
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
                event.preventDefault();
                _showRailFlyout(flyout, true);
            }
        });

        document.addEventListener('click', (event) => {
            const panel = document.getElementById('sidebarRailFloat');
            if (!panel || panel.hidden) return;
            if (panel.contains(event.target)) return;
            if (_state.railActiveAnchor?.contains(event.target)) return;
            _closeRailFloat();
        }, true);

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') _closeRailFloat();
        });
        window.addEventListener('resize', _closeRailFloat);
        window.addEventListener('scroll', _handleRailFloatDocumentScroll, true);
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
            const authHeaders = _sidebarAuthHeaders(token);
            const [alertsR, countersR] = await Promise.allSettled([
                fetch(_sidebarScopedApiUrl('/api/dashboard/alerts'), { headers: authHeaders }).then(r => r.json()),
                _fetchBusinessLiveCounters(authHeaders),
            ]);
            const alertCount = alertsR.status === 'fulfilled' ? (alertsR.value?.count || 0) : 0;
            const liveCounters = countersR.status === 'fulfilled' ? countersR.value : null;
            const leadCounters = _businessLiveCounterBucket(liveCounters).leads || {};
            const leadsNew = _toSidebarCounterValue(leadCounters.new);
            const scopeLabel = _businessScopeCounterLabel(_businessLiveCounterScope(liveCounters || {}));
            _setBadge('alerts', alertCount > 0 ? alertCount : null);
            if (alertsR.status === 'fulfilled') _renderSidebarAlerts(alertsR.value);
            _setBadge('leads_new', leadsNew > 0 ? leadsNew : null, `Нові ліди: ${leadsNew}. ${scopeLabel}.`);
        } catch {}
        const chatUnread = typeof ChatState !== 'undefined' ? (ChatState.totalUnread || 0) : 0;
        _setBadge('unread', chatUnread > 0 ? chatUnread : null);
        _syncNavStatusLabels();
        _state.badgeTimer = setTimeout(_fetchLiveBadges, 300000);
    }

    function _setBadge(type, value, accessibleLabel = '') {
        document.querySelectorAll(`[data-badge-type="${type}"]`).forEach(el => {
            if (value === null || value === undefined || value === 0) {
                el.style.display = 'none';
                el.removeAttribute('aria-label');
                el.removeAttribute('title');
            } else {
                el.style.display = 'inline-flex';
                el.textContent = typeof value === 'number' && value > 99 ? '99+' : String(value);
                if (accessibleLabel) {
                    el.setAttribute('aria-label', accessibleLabel);
                    el.setAttribute('title', accessibleLabel);
                }
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
            art_director: 'Арт-директор',
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

    function _sidebarRoleBadgeKey(user) {
        const raw = _getSidebarPrimaryRole(user) || 'crm';
        const key = String(raw || 'crm').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
        return key || 'crm';
    }

    function _sidebarRoleBadgeText(user) {
        const raw = _getSidebarPrimaryRole(user) || 'crm';
        const label = _sidebarRoleLabel(raw);
        return label || _sidebarRoleBadgeKey(user).replace(/_/g, ' ');
    }

    function _ensureCommandDeck() {
        const sidebar = document.getElementById('sidebarNav');
        if (!sidebar) return;
        sidebar.querySelector('.sidebar-pills')?.remove();
        sidebar.querySelector('.sidebar-dashboard-jump-wrap')?.remove();

        const links = sidebar.querySelector('.sidebar-links');
        if (!links) return;

        let deck = document.getElementById('sidebarCommandDeck');
        const currencySignalEnabled = _isSidebarCurrencySignalEnabled();
        if (!deck) {
            deck = document.createElement('div');
            deck.id = 'sidebarCommandDeck';
            deck.className = 'sidebar-command-deck';
            deck.innerHTML = `
                <span class="sidebar-command-kicker">Помічник · операційний стан</span>
                <div class="sidebar-identity-card" id="sidebarIdentityCard" aria-label="Відкрити профіль">
                    <span class="sidebar-identity-title-row">
                        <span class="sidebar-identity-title-line">
                            <span class="sidebar-identity-name" id="sidebarIdentityName">Event Genix</span>
                        </span>
                        <span class="sidebar-identity-role" id="sidebarIdentityRole">CRM</span>
                    </span>
                    <span class="sidebar-identity-portrait">
                        <span class="sidebar-identity-avatar" id="sidebarIdentityAvatar">?</span>
                        <span class="sidebar-identity-aux" id="sidebarIdentityAux" data-sidebar-stop-profile="true" aria-label="Час і дата">
                            <span class="sidebar-identity-aux-item" data-sidebar-meta="time" data-sidebar-static="true" aria-label="Поточний час">
                                <span class="sidebar-identity-aux-k">Час</span>
                                <span class="sidebar-identity-aux-v" id="sidebarIdentityTime">--:--</span>
                            </span>
                            <span class="sidebar-identity-aux-item" data-sidebar-meta="date" data-sidebar-static="true" aria-label="Сьогоднішній день">
                                <span class="sidebar-identity-aux-k">День</span>
                                <span class="sidebar-identity-aux-v" id="sidebarIdentityDate">--.--</span>
                            </span>
                        </span>
                    </span>
                    <span class="sidebar-identity-main">
                        <span class="sidebar-identity-summary" id="sidebarIdentitySummary">Операційний стан завантажується...</span>
                        <span class="sidebar-identity-meta" id="sidebarIdentityMeta" aria-label="Курс USD">
                            <button type="button" class="sidebar-identity-meta-item" data-sidebar-meta="currency" data-sidebar-stop-profile="true" aria-label="Курси валют у фінансах" title="Відкрити курси валют у фінансах"${currencySignalEnabled ? '' : ' hidden'}>
                                <span class="sidebar-identity-meta-k">USD</span>
                                <span class="sidebar-identity-meta-v" id="sidebarIdentityCurrency">--.--</span>
                            </button>
                        </span>
                    </span>
                    <span class="sidebar-business-context" id="sidebarBusinessContextHost" data-sidebar-stop-profile="true"></span>
                    <span class="sidebar-identity-chevron" aria-hidden="true">›</span>
                </div>

                <div class="sidebar-focus-deck" id="sidebarFocusDeck" aria-label="Операційний фокус">
                    <a href="/tasks?view=my" class="focus-chip focus-chip--tasks" id="focusChipTasks" data-metric-kind="tasks" aria-label="Мої задачі">
                        <span class="focus-chip-icon">${_renderStatusIcon('tasks')}</span>
                        <span class="focus-chip-task-split" aria-hidden="true">
                            <span class="focus-chip-task-part focus-chip-task-part--done">
                                <span class="focus-chip-task-mark">✓</span>
                                <span class="focus-chip-task-number" id="focusChipTasksDoneValue">0</span>
                            </span>
                            <span class="focus-chip-task-divider"></span>
                            <span class="focus-chip-task-part focus-chip-task-part--remaining">
                                <span class="focus-chip-task-mark">!</span>
                                <span class="focus-chip-value focus-chip-task-number" id="focusChipTasksValue">0</span>
                            </span>
                        </span>
                        <span class="focus-chip-label">Задачі</span>
                        <span class="focus-chip-meta" id="focusChipTasksMeta">спокійно</span>
                    </a>
                    <button type="button" class="focus-chip focus-chip--alerts" id="focusChipAlerts" data-metric-kind="alerts" aria-label="Алерти">
                        <span class="focus-chip-icon">${_renderStatusIcon('alerts')}</span>
                        <span class="focus-chip-value" id="focusChipAlertsValue">0</span>
                        <span class="focus-chip-label">Алерти</span>
                        <span class="focus-chip-meta" id="focusChipAlertsMeta">спокійно</span>
                    </button>
                    <a href="/sales-funnel" class="focus-chip focus-chip--funnel" id="focusChipFunnel" data-metric-kind="leads" aria-label="Ліди">
                        <span class="focus-chip-icon">${_renderStatusIcon('funnel')}</span>
                        <span class="focus-chip-value" id="focusChipFunnelValue">0</span>
                        <span class="focus-chip-label">Ліди</span>
                        <span class="focus-chip-meta" id="focusChipFunnelMeta">без нових</span>
                    </a>
                </div>`;
        }
        if (deck.parentElement !== sidebar) {
            sidebar.insertBefore(deck, links);
        }

        const savedUser = _getCurrentSidebarUser();
        const role = _getSidebarActiveRole(savedUser);
        const extraItems = _getExtraMenuItems(role);
        const selectableExtraItems = _getSelectableExtraMenuItems(role);
        const selectedExtraHrefs = _getSelectedExtraMenuHrefs(role);
        const extraEditorOpen = _isExtraMenuEditorOpen();
        const extraCollapsed = _isExtraMenuCollapsed();
        const extraListHidden = extraEditorOpen || extraCollapsed;
        const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        const currentHash = location.hash.replace('#', '');
        let extras = document.getElementById('sidebarDesignExtras');
        if (!extras) {
            extras = document.createElement('div');
            extras.id = 'sidebarDesignExtras';
        }
        extras.className = `sidebar-design-extras${extraEditorOpen ? ' is-editing' : ''}${extraCollapsed && !extraEditorOpen ? ' is-collapsed' : ''}`;
        extras.innerHTML = `
                <div class="sidebar-design-extras-head-row">
                <button type="button" class="sidebar-design-extras-head" data-sidebar-extra-toggle-section aria-expanded="${extraListHidden ? 'false' : 'true'}">
                    <span class="sidebar-design-extras-dot" aria-hidden="true"></span>
                    <span class="sidebar-design-extras-copy">
                        <span class="sidebar-design-extras-title">Обране</span>
                    </span>
                    <span class="sidebar-design-extras-chevron" aria-hidden="true">${extraListHidden ? '⌄' : '⌃'}</span>
                </button>
                    <button type="button" class="sidebar-design-extras-manage" data-sidebar-extra-toggle-editor aria-expanded="${extraEditorOpen ? 'true' : 'false'}" aria-label="${extraEditorOpen ? 'Завершити редагування обраного' : 'Редагувати обране'}" title="${extraEditorOpen ? 'Готово' : 'Редагувати обране'}">
                        <span class="sidebar-design-extras-gear" aria-hidden="true">⚙</span>
                        <span class="sidebar-design-extras-manage-text">${extraEditorOpen ? 'Готово' : 'Редагувати'}</span>
                    </button>
                </div>
                <div class="sidebar-design-extra-list"${extraListHidden ? ' hidden' : ''}>
                    ${extraItems.length ? extraItems.map(item => _renderExtraMenuLink(item, currentPath, currentHash, { editMode: extraEditorOpen })).join('') : '<div class="sidebar-design-extra-empty">Нічого не вибрано. Натисни шестерню і постав галочки.</div>'}
                </div>
                ${extraEditorOpen ? _renderExtraMenuEditor(selectableExtraItems, selectedExtraHrefs) : ''}`;
        if (extras.parentElement !== sidebar) sidebar.insertBefore(extras, links);

        let productivity = document.getElementById('sidebarProductivityQuick');
        if (!productivity) {
            productivity = document.createElement('div');
            productivity.id = 'sidebarProductivityQuick';
        }
        const productivityItems = _getProductivityItems(role);
        const selectableProductivityItems = _getSelectableProductivityItems(role);
        const selectedProductivityHrefs = _getSelectedProductivityHrefs(role);
        const productivityEditorOpen = _isProductivityEditorOpen();
        const productivityCollapsed = _isProductivityCollapsed();
        const productivityListHidden = productivityEditorOpen || productivityCollapsed;
        productivity.className = `sidebar-design-extras sidebar-productivity-quick${productivityEditorOpen ? ' is-editing' : ''}${productivityCollapsed && !productivityEditorOpen ? ' is-collapsed' : ''}`;
        productivity.innerHTML = _renderProductivityQuickBlock(currentPath, currentHash, {
            items: productivityItems,
            selectableItems: selectableProductivityItems,
            selectedHrefs: selectedProductivityHrefs,
            editorOpen: productivityEditorOpen,
            listHidden: productivityListHidden
        });
        if (productivity.parentElement !== sidebar) sidebar.insertBefore(productivity, links);

        _syncSidebarSectionOrder(sidebar, links);
        _bindExtraMenuEditor(extras);
        _bindProductivityQuickBlock(productivity);

        const alertsChip = document.getElementById('focusChipAlerts');
        if (alertsChip && alertsChip.dataset.alertsBound !== 'true') {
            alertsChip.dataset.alertsBound = 'true';
            alertsChip.addEventListener('click', openAlerts);
        }

        _hydrateCommandDeckUser();
        _ensureSidebarIdentityMeta();
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
        const roleKey = _sidebarRoleBadgeKey(user);
        _paintUserAvatar(avatarEl, user);
        if (nameEl) nameEl.textContent = user.name || user.username || 'Event Genix';
        if (roleEl) {
            roleEl.textContent = _sidebarRoleBadgeText(user);
            roleEl.dataset.role = roleKey;
            roleEl.setAttribute('aria-label', _sidebarRoleLine(user));
            roleEl.title = _sidebarRoleLine(user);
        }
        if (cardEl) cardEl.dataset.role = roleKey;
        _syncSidebarBusinessSwitcher(user);
        _bindProfileEntry(cardEl);
    }

    function _cleanSidebarBusinessLabel(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function _firstSidebarBusinessWord(value) {
        return _cleanSidebarBusinessLabel(value).split(' ')[0] || '';
    }

    function _sidebarBusinessFullLabel(ctx = {}) {
        return _cleanSidebarBusinessLabel(ctx.label || ctx.brandName || ctx.name || ctx.shortLabel || ctx.key);
    }

    function _sidebarBusinessDisplayLabel(ctx = {}, options = {}) {
        const fullLabel = _sidebarBusinessFullLabel(ctx);
        const shortLabel = _cleanSidebarBusinessLabel(ctx.switchLabel || ctx.shortLabel);
        const firstWord = _firstSidebarBusinessWord(fullLabel);
        const keyLabel = _cleanSidebarBusinessLabel(ctx.key);
        const maxFullLength = options.compact ? 8 : 12;
        if (fullLabel && fullLabel.length <= maxFullLength) return fullLabel;
        if (firstWord && firstWord.length >= 3 && firstWord.length <= 12) return firstWord;
        return shortLabel || firstWord || fullLabel || keyLabel;
    }

    function _syncSidebarBusinessSwitcher(user = _getCurrentSidebarUser()) {
        const host = document.getElementById('sidebarBusinessContextHost');
        const api = window.CrmBusinessContext;
        if (!host || !api?.options || !api?.current) return;
        _bindSidebarBusinessSettingsDismiss();
        const businessState = api.state?.(user) || null;
        const options = businessState?.availableBusinesses?.length
            ? businessState.availableBusinesses.map(ctx => ({
                key: ctx.key || ctx.id,
                label: ctx.label,
                shortLabel: ctx.shortLabel,
                switchLabel: ctx.switchLabel,
                route: ctx.route
            }))
            : api.options(user);
        if (!options.length) {
            host.innerHTML = '';
            host.hidden = true;
            _state.businessSettingsOpen = false;
            return;
        }
        host.hidden = false;
        host.setAttribute('role', 'group');
        host.setAttribute('aria-label', 'Бізнес CRM');
        host.dataset.switching = _state.businessSwitching ? 'true' : 'false';
        host.setAttribute('aria-busy', _state.businessSwitching ? 'true' : 'false');
        const scope = businessState?.scope || api.scope?.(user) || {
            mode: 'single',
            activeContext: businessState?.activeBusinessId || api.current(user),
            selectedContexts: [businessState?.activeBusinessId || api.current(user)],
            readOnly: false
        };
        const current = scope.activeContext || businessState?.activeBusinessId || api.current(user);
        const currentContext = options.find(ctx => ctx.key === current) || options[0];
        const sidebar = document.getElementById('sidebarNav');
        const compactBusinessLabel = sidebar?.classList.contains('collapsed');
        const businessLabelFor = (ctx) => _sidebarBusinessDisplayLabel(ctx, { compact: compactBusinessLabel });
        const businessFullLabelFor = (ctx) => _sidebarBusinessFullLabel(ctx) || businessLabelFor(ctx);
        host.dataset.activeBusiness = currentContext.key || current;
        if (options.length <= 1) {
            _state.businessSettingsOpen = false;
            host.innerHTML = `
                <span class="sidebar-business-chip" title="${_escAttr(businessFullLabelFor(currentContext))}" aria-label="${_escAttr(businessFullLabelFor(currentContext))}">${_escAttr(businessLabelFor(currentContext))}</span>`;
            return;
        }
        const aggregateAllowed = Boolean(
            businessState?.canUseAggregateBusinessScope
            && typeof api.switchScope === 'function'
            && (typeof api.allowsAggregate !== 'function' || api.allowsAggregate(api.currentPage?.()))
        );
        const selectedContexts = Array.isArray(scope.selectedContexts) && scope.selectedContexts.length
            ? scope.selectedContexts
            : [currentContext.key || current];
        const selectedSet = new Set(selectedContexts);
        const activeMode = aggregateAllowed ? (scope.mode || 'single') : 'single';
        host.dataset.businessScope = activeMode;
        const scopeLabels = {
            single: 'Один',
            multi: 'Кілька',
            all: 'Усі'
        };
        const settingsOpen = Boolean(_state.businessSettingsOpen);
        const scopeSummary = activeMode === 'all'
            ? 'Усі бізнеси'
            : (activeMode === 'multi' ? `${selectedContexts.length} бізнеси` : 'Один бізнес');
        const readOnlyNote = scope.readOnly
            ? '<span class="sidebar-business-readonly-note">Огляд без змін</span>'
            : '';
        const modeControls = aggregateAllowed ? `
            <span class="sidebar-business-settings-summary">
                <span>Режим огляду</span>
                <strong>${_escAttr(scopeSummary)}</strong>
            </span>
            <span class="sidebar-business-scope" role="group" aria-label="Режим бізнес-огляду" data-sidebar-business-scope="true">
                ${['single', 'multi', 'all'].map(mode => `<button type="button" class="sidebar-business-scope-btn${mode === activeMode ? ' active' : ''}" data-business-scope-mode="${mode}" aria-pressed="${mode === activeMode ? 'true' : 'false'}"${_state.businessSwitching ? ' disabled' : ''}>${scopeLabels[mode]}</button>`).join('')}
            </span>
            ${readOnlyNote}
            ${activeMode === 'multi' ? `<span class="sidebar-business-multi" role="group" aria-label="Вибрані бізнеси">
                ${options.map(ctx => `<label class="sidebar-business-multi-option">
                    <input class="sidebar-business-multi-check" type="checkbox" value="${_escAttr(ctx.key)}"${selectedSet.has(ctx.key) ? ' checked' : ''}${_state.businessSwitching ? ' disabled' : ''}>
                    <span>${_escAttr(ctx.shortLabel || ctx.label || ctx.key)}</span>
                </label>`).join('')}
            </span>` : ''}
        ` : `
            <span class="sidebar-business-settings-summary">
                <span>Режим огляду</span>
                <strong>Один бізнес</strong>
            </span>
            <span class="sidebar-business-unavailable">Кілька бізнесів доступні на сторінках огляду: Дашборд, Продукти, Ліди, Клієнти та Звіти.</span>
        `;
        host.innerHTML = `
            <span class="sidebar-business-control-row">
                <select class="sidebar-business-select" id="sidebarBusinessContextSelect" aria-label="${_escAttr(`Поточний бізнес CRM: ${businessFullLabelFor(currentContext)}`)}" title="${_escAttr(businessFullLabelFor(currentContext))}" data-sidebar-business-switcher="true"${_state.businessSwitching ? ' disabled' : ''}>
                    ${options.map(ctx => `<option value="${_escAttr(ctx.key)}"${ctx.key === current ? ' selected' : ''} title="${_escAttr(businessFullLabelFor(ctx))}" data-full-label="${_escAttr(businessFullLabelFor(ctx))}" data-display-label="${_escAttr(businessLabelFor(ctx))}">${_escAttr(businessLabelFor(ctx))}</option>`).join('')}
                </select>
                <button type="button" class="sidebar-business-settings-btn${settingsOpen ? ' active' : ''}" data-sidebar-business-settings-toggle aria-expanded="${settingsOpen ? 'true' : 'false'}" aria-controls="sidebarBusinessSettingsPanel" aria-label="Налаштування бізнес-огляду" title="Налаштування бізнес-огляду"${_state.businessSwitching ? ' disabled' : ''}>
                    <span aria-hidden="true">⚙</span>
                </button>
            </span>
            <span class="sidebar-business-settings-panel${settingsOpen ? ' open' : ''}" id="sidebarBusinessSettingsPanel" role="group" aria-label="Налаштування бізнес-огляду" aria-hidden="${settingsOpen ? 'false' : 'true'}"${settingsOpen ? '' : ' inert'}>
                ${modeControls}
            </span>`;
        const select = host.querySelector('#sidebarBusinessContextSelect');
        if (!select) return;
        select.title = businessFullLabelFor(currentContext);
        select.setAttribute('aria-label', `Поточний бізнес CRM: ${businessFullLabelFor(currentContext)}`);
        const finishSwitch = () => {
            if (window.__crmBusinessNavigationPending) return true;
            const container = document.querySelector('#sidebarLinks') || document.querySelector('#sidebarNav .sidebar-links');
            if (container?.id) render('#' + container.id);
            if (api.hasPageBinding?.()) return false;
            setTimeout(() => window.location.reload(), 50);
            return true;
        };
        const runBusinessSwitch = async (handler, resetValue = null) => {
            if (_state.businessSwitching) return;
            _state.businessSwitching = true;
            host.dataset.switching = 'true';
            host.setAttribute('aria-busy', 'true');
            host.querySelectorAll('select, button, input').forEach(control => { control.disabled = true; });
            let reloadPending = false;
            try {
                await handler();
                reloadPending = finishSwitch();
            } catch (error) {
                console.error('[sidebar] business switch failed', error);
                if (resetValue !== null) select.value = resetValue;
                if (typeof showNotification === 'function') {
                    showNotification('Не вдалося перемкнути бізнес. Оновіть сторінку і повторіть.', 'error');
                }
            } finally {
                if (!window.__crmBusinessNavigationPending && !reloadPending) {
                    _state.businessSwitching = false;
                    _syncSidebarBusinessSwitcher(user);
                }
            }
        };
        const settingsToggle = host.querySelector('[data-sidebar-business-settings-toggle]');
        if (settingsToggle) {
            settingsToggle.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (_state.businessSwitching) return;
                _state.businessSettingsOpen = !_state.businessSettingsOpen;
                _syncSidebarBusinessSwitcher(user);
            });
            settingsToggle.addEventListener('keydown', event => event.stopPropagation());
        }
        const settingsPanel = host.querySelector('#sidebarBusinessSettingsPanel');
        if (settingsPanel) {
            settingsPanel.addEventListener('click', event => event.stopPropagation());
            settingsPanel.addEventListener('keydown', event => {
                event.stopPropagation();
                if (event.key === 'Escape') {
                    _state.businessSettingsOpen = false;
                    _syncSidebarBusinessSwitcher(user);
                    settingsToggle?.focus?.();
                }
            });
        }
        select.addEventListener('click', event => event.stopPropagation());
        select.addEventListener('keydown', event => event.stopPropagation());
        select.addEventListener('change', async event => {
            event.stopPropagation();
            if (_state.businessSwitching) {
                event.target.value = host.dataset.activeBusiness || current;
                return;
            }
            const previous = api.current(user);
            if (event.target.value === previous) return;
            await runBusinessSwitch(async () => {
                await api.switchTo(event.target.value, { user, updateUrl: true, allowAggregate: true });
            }, previous);
        });
        host.querySelectorAll('[data-business-scope-mode]').forEach(button => {
            button.addEventListener('click', async event => {
                event.preventDefault();
                event.stopPropagation();
                const mode = event.currentTarget.dataset.businessScopeMode;
                if (!mode || mode === activeMode || _state.businessSwitching) return;
                const currentKey = select.value || currentContext.key || current;
                const fallbackSecond = options.find(ctx => ctx.key !== currentKey)?.key;
                const currentSelected = selectedContexts.filter(key => options.some(ctx => ctx.key === key));
                const multiContexts = currentSelected.length >= 2
                    ? currentSelected
                    : [currentKey, fallbackSecond].filter(Boolean);
                const nextScope = mode === 'all'
                    ? { mode: 'all', activeContext: currentKey }
                    : (mode === 'multi'
                        ? { mode: 'multi', activeContext: multiContexts[0] || currentKey, selectedContexts: multiContexts }
                        : { mode: 'single', activeContext: currentKey, selectedContexts: [currentKey] });
                await runBusinessSwitch(() => api.switchScope(nextScope, {
                    user,
                    updateUrl: true,
                    allowAggregate: true,
                    navigate: mode === 'single'
                }));
            });
        });
        host.querySelectorAll('.sidebar-business-multi-check').forEach(input => {
            input.addEventListener('click', event => event.stopPropagation());
            input.addEventListener('change', async event => {
                event.stopPropagation();
                if (_state.businessSwitching) return;
                const selected = Array.from(host.querySelectorAll('.sidebar-business-multi-check:checked')).map(item => item.value);
                if (selected.length < 2) {
                    event.target.checked = true;
                    if (typeof showNotification === 'function') {
                        showNotification('Для режиму “Кілька” залиште щонайменше два бізнеси.', 'warning');
                    }
                    return;
                }
                const activeContext = selected.includes(scope.activeContext) ? scope.activeContext : selected[0];
                await runBusinessSwitch(() => api.switchScope({
                    mode: 'multi',
                    activeContext,
                    selectedContexts: selected
                }, {
                    user,
                    updateUrl: true,
                    allowAggregate: true,
                    navigate: false
                }));
            });
        });
    }

    function _bindSidebarBusinessSettingsDismiss() {
        if (_state.businessSettingsDocumentBound || typeof document === 'undefined') return;
        _state.businessSettingsDocumentBound = true;
        document.addEventListener('click', event => {
            if (!_state.businessSettingsOpen) return;
            const host = document.getElementById('sidebarBusinessContextHost');
            if (host?.contains(event.target)) return;
            _state.businessSettingsOpen = false;
            _syncSidebarBusinessSwitcher();
        }, true);
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || !_state.businessSettingsOpen) return;
            _state.businessSettingsOpen = false;
            _syncSidebarBusinessSwitcher();
        });
    }

    function _formatSidebarKyivTime(date = new Date()) {
        try {
            return new Intl.DateTimeFormat('uk-UA', {
                timeZone: 'Europe/Kyiv',
                hour: '2-digit',
                minute: '2-digit'
            }).format(date);
        } catch (err) {
            return date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        }
    }

    function _formatSidebarKyivDate(date = new Date()) {
        try {
            const parts = new Intl.DateTimeFormat('uk-UA', {
                timeZone: 'Europe/Kyiv',
                weekday: 'short',
                day: '2-digit'
            }).formatToParts(date);
            const weekday = (parts.find(part => part.type === 'weekday')?.value || '').replace(/\.$/, '');
            const day = parts.find(part => part.type === 'day')?.value || '';
            return [weekday, day].filter(Boolean).join(', ');
        } catch (err) {
            return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
        }
    }

    function _setSidebarIdentityMetaValue(id, value, state = '') {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = value;
        const item = el.closest('.sidebar-identity-meta-item');
        if (item) item.dataset.state = state || '';
    }

    function _escHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function _updateSidebarIdentityTime() {
        const now = new Date();
        _setSidebarIdentityMetaValue('sidebarIdentityTime', _formatSidebarKyivTime(now), 'live');
        _setSidebarIdentityMetaValue('sidebarIdentityDate', _formatSidebarKyivDate(now), 'live');
        _state.identityMetaDetails.time = {
            time: _formatSidebarKyivTime(now),
            date: _formatSidebarKyivDate(now),
            label: 'Київський час',
            timezone: 'Europe/Kyiv'
        };
    }

    function _formatSidebarMoney(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount <= 0) return 'н/д';
        return `₴${amount.toFixed(2)}`;
    }

    async function _fetchSidebarWidget(type) {
        const url = SIDEBAR_IDENTITY_WIDGETS[type];
        if (!url) throw new Error(`unknown sidebar widget ${type}`);
        const token = localStorage.getItem('pzp_token');
        const response = await fetch(url, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!response.ok) throw new Error(`sidebar widget ${type} failed`);
        return response.json();
    }

    async function _fetchSidebarCurrencyFallback() {
        const token = localStorage.getItem('pzp_token');
        const response = await fetch('/api/finance/currency/rates', {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!response.ok) throw new Error('sidebar currency fallback failed');
        return response.json();
    }

    function _normalizeSidebarCurrencyRates(source) {
        const rates = source?.rates && typeof source.rates === 'object'
            ? { ...source.rates }
            : {};
        ['usd', 'eur', 'gbp', 'pln', 'czk'].forEach((key) => {
            const upper = key.toUpperCase();
            if (Number.isFinite(Number(source?.[key])) && !Number.isFinite(Number(rates[upper]))) {
                rates[upper] = Number(source[key]);
            }
        });
        return {
            base: source?.base || 'UAH',
            date: source?.date || source?.updatedAt || '',
            rates
        };
    }

    function _mergeSidebarCurrencyRates(primary, fallback) {
        const first = _normalizeSidebarCurrencyRates(primary || {});
        const second = _normalizeSidebarCurrencyRates(fallback || {});
        return {
            base: first.base || second.base || 'UAH',
            date: first.date || second.date || '',
            rates: { ...second.rates, ...first.rates }
        };
    }

    async function _loadSidebarIdentityMeta(force = false) {
        if (!_isSidebarCurrencySignalEnabled()) {
            _state.identityMetaDetails.currency = null;
            return;
        }
        const now = Date.now();
        if (_state.identityMetaLoading) return;
        if (!force && _state.identityMetaLoadedAt && now - _state.identityMetaLoadedAt < 10 * 60 * 1000) return;
        _state.identityMetaLoading = true;
        try {
            const [currencyResult, currencyFallbackResult] = await Promise.allSettled([
                _fetchSidebarWidget('currency'),
                _fetchSidebarCurrencyFallback()
            ]);
            const dashboardCurrency = currencyResult.status === 'fulfilled' && currencyResult.value && !currencyResult.value.error
                ? currencyResult.value
                : null;
            const fallbackCurrency = currencyFallbackResult.status === 'fulfilled' ? currencyFallbackResult.value : null;
            const currencyDetails = _mergeSidebarCurrencyRates(dashboardCurrency, fallbackCurrency);
            const usdRate = Number(currencyDetails.rates?.USD || currencyDetails.usd || 0);
            _state.identityMetaDetails.currency = currencyDetails;
            _setSidebarIdentityMetaValue(
                'sidebarIdentityCurrency',
                _formatSidebarMoney(usdRate),
                Number.isFinite(usdRate) && usdRate > 0 ? 'live' : 'limited'
            );
        } catch (err) {
            _state.identityMetaDetails.currency = null;
            _setSidebarIdentityMetaValue('sidebarIdentityCurrency', 'н/д', 'limited');
        } finally {
            _state.identityMetaLoadedAt = Date.now();
            _state.identityMetaLoading = false;
        }
    }

    function _ensureSidebarIdentityMeta() {
        _updateSidebarIdentityTime();
        const currencyItem = document.querySelector('.sidebar-identity-meta-item[data-sidebar-meta="currency"]');
        if (currencyItem) currencyItem.hidden = !_isSidebarCurrencySignalEnabled();
        _bindSidebarIdentityMetaInteractions();
        if (!_state.identityMetaTimer) {
            _state.identityMetaTimer = window.setInterval(_updateSidebarIdentityTime, 30 * 1000);
        }
        if (_isSidebarCurrencySignalEnabled()) _loadSidebarIdentityMeta();
    }

    function _sidebarCurrencyRows(details) {
        const rates = details?.rates || {};
        const order = ['USD', 'EUR', 'GBP', 'PLN', 'CZK'];
        return order
            .filter(code => Number.isFinite(Number(rates[code])) && Number(rates[code]) > 0)
            .map(code => `<span class="sidebar-identity-detail-rate"><b>${_escHtml(code)}</b><span>${_escHtml(_formatSidebarMoney(rates[code]))}</span></span>`)
            .join('');
    }

    function _renderSidebarIdentityDetail(type) {
        if (type === 'currency') {
            const details = _state.identityMetaDetails.currency || {};
            const rows = _sidebarCurrencyRows(details);
            return `
                <div class="sidebar-identity-detail-head">
                    <strong>Курси валют</strong>
                    <button type="button" class="sidebar-identity-detail-close" data-sidebar-detail-close aria-label="Закрити">×</button>
                </div>
                <div class="sidebar-identity-detail-body">
                    ${rows || '<span class="sidebar-identity-detail-muted">Курси тимчасово недоступні.</span>'}
                    <span class="sidebar-identity-detail-muted">База: ${_escHtml(details.base || 'UAH')}${details.date ? ` · ${_escHtml(details.date)}` : ''}</span>
                </div>
                <a class="sidebar-identity-detail-link" href="/finance?currency=rates">Відкрити фінанси ›</a>`;
        }
        return `
            <div class="sidebar-identity-detail-head">
                <strong>Час</strong>
                <button type="button" class="sidebar-identity-detail-close" data-sidebar-detail-close aria-label="Закрити">×</button>
            </div>
            <div class="sidebar-identity-detail-body">
                <span class="sidebar-identity-detail-big">${_escHtml(_formatSidebarKyivTime())}</span>
                <span>Київський час · Europe/Kyiv</span>
            </div>`;
    }

    function _showSidebarIdentityDetail(type) {
        if (type === 'currency') {
            _openFinanceCurrencyRates();
            return;
        }
        const deck = document.getElementById('sidebarCommandDeck');
        if (!deck) return;
        let panel = document.getElementById('sidebarIdentityDetailPanel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'sidebarIdentityDetailPanel';
            panel.className = 'sidebar-identity-detail-panel';
            panel.setAttribute('data-sidebar-stop-profile', 'true');
            deck.appendChild(panel);
        }
        panel.dataset.type = type;
        panel.innerHTML = _renderSidebarIdentityDetail(type);
        panel.hidden = false;
        panel.querySelector('[data-sidebar-detail-close]')?.addEventListener('click', () => {
            panel.hidden = true;
        });
    }

    function _bindSidebarIdentityMetaInteractions() {
        document.querySelectorAll('.sidebar-identity-meta-item').forEach((item) => {
            if (item.dataset.sidebarMetaBound === 'true') return;
            item.dataset.sidebarMetaBound = 'true';
            if (item.dataset.sidebarStatic === 'true') return;
            item.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                _showSidebarIdentityDetail(item.dataset.sidebarMeta || 'time');
            });
        });
    }

    function _openFinanceCurrencyRates() {
        const normalizedPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        if (normalizedPath === '/finance') {
            try {
                const url = new URL(window.location.href);
                url.searchParams.set('currency', 'rates');
                window.history.replaceState({}, '', url.toString());
            } catch {}
            window.dispatchEvent(new CustomEvent('finance:open-currency-rates', { detail: { source: 'sidebar' } }));
            return;
        }
        window.location.href = '/finance?currency=rates';
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
        const metricTone = getMetricTone(options.kind || widget.dataset.metricKind || 'tasks', safeCount);
        widget.dataset.sidebarCount = String(safeCount);
        widget.dataset.sidebarSeverity = severity;
        widget.dataset.metricTone = metricTone;
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

    function _getSidebarHeroTone(state = _commandState) {
        if (state.alertsCritical > 0) return 'critical';
        if (state.alertsUnread > 0 || state.tasksOverdue > 0 || state.hotLeads > 0) return 'warning';
        if (state.tasksActive > 0 || state.newLeads > 0) return 'info';
        return 'ok';
    }

    function _sidebarToneLabel(tone) {
        return {
            critical: 'КРИТИЧНО',
            warning: 'УВАГА',
            info: 'ІНФО',
            ok: 'УСЕ ОК'
        }[tone] || 'ГОТОВО';
    }

    function _updateSidebarCommandDeck() {
        const tone = _getSidebarHeroTone(_commandState);
        const deck = document.getElementById('sidebarCommandDeck');
        if (deck) deck.dataset.tone = tone;

        const healthEl = document.getElementById('sidebarIdentityHealth');
        const healthLabel = document.getElementById('sidebarIdentityHealthLabel');
        if (healthEl) healthEl.dataset.tone = tone;
        if (healthLabel) healthLabel.textContent = _sidebarToneLabel(tone);

        const summaryEl = document.getElementById('sidebarIdentitySummary');
        if (summaryEl) summaryEl.textContent = _getSidebarSummaryState();
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
            kind: 'alerts',
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
        if (!_canSeeSidebarTaskSurface()) {
            widget.hidden = true;
            _commandState.tasksActive = 0;
            _commandState.tasksCompleted = 0;
            _commandState.tasksOverdue = 0;
            _syncFocusDeckAccess();
            return;
        }
        widget.hidden = false;
        const token = localStorage.getItem('pzp_token');
        if (!token) return;
        try {
            const authHeaders = typeof getAuthHeaders === 'function'
                ? getAuthHeaders(false)
                : { 'Authorization': 'Bearer ' + token };
            const scopedApiUrl = window.CrmBusinessContext?.apiUrl || (url => url);
            const cabinet = await fetch(scopedApiUrl('/api/tasks/my-cabinet'), {
                headers: authHeaders
            }).then(r => r.ok ? r.json() : null).catch(() => null);
            let completedCount = 0;
            let activeCount = 0;
            let overdueCount = 0;
            if (cabinet?.success) {
                const quick = _sidebarTaskQuickCountsFromCabinet(cabinet);
                completedCount = quick.completed;
                activeCount = quick.open;
                overdueCount = quick.overdue;
            } else {
                const rows = await fetch(scopedApiUrl('/api/tasks?limit=200'), {
                    headers: authHeaders
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
                const today = _sidebarKyivToday();
                const openMine = mine.filter(_isSidebarTaskOpen);
                completedCount = mine.filter(task => _isSidebarTaskCompletedToday(task, today)).length;
                activeCount = openMine.length;
                overdueCount = openMine.filter(task => task.deadline && new Date(task.deadline) < new Date()).length;
            }
            const doneEl = document.getElementById('focusChipTasksDoneValue');
            const countEl = document.getElementById('focusChipTasksValue');
            const metaEl = document.getElementById('focusChipTasksMeta');
            if (doneEl) doneEl.textContent = _formatTaskWidgetCount(completedCount);
            if (countEl) countEl.textContent = _formatTaskWidgetCount(activeCount);
            if (metaEl) {
                const parts = ['відкриті'];
                if (overdueCount > 0) parts.push(`${overdueCount} простр.`);
                metaEl.textContent = parts.join(' · ');
            }
            const taskTitle = overdueCount > 0
                ? `Задачі: ${completedCount} виконано сьогодні, ${activeCount} відкритих задач у поточному бізнес-контексті, ${overdueCount} прострочені. Натисніть, щоб відкрити всі задачі.`
                : `Задачі: ${completedCount} виконано сьогодні, ${activeCount} відкритих задач у поточному бізнес-контексті. Натисніть, щоб відкрити всі задачі.`;
            _commandState.tasksActive = activeCount;
            _commandState.tasksCompleted = completedCount;
            _commandState.tasksOverdue = overdueCount;
            _setCommandDescription(widget, taskTitle);
            widget.classList.toggle('has-overdue', overdueCount > 0);
            _setFocusChipOperationalState(widget, activeCount, { kind: 'tasks', critical: overdueCount > 0 });
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
        const role = _getSidebarActiveRole(user);
        const canSeeFunnel = role ? hasAccess({ access: 'leads' }, role) : true;
        widget.hidden = !canSeeFunnel;
        _syncFocusDeckAccess(canSeeFunnel);
        if (!canSeeFunnel) return;

        const token = localStorage.getItem('pzp_token');
        if (!token) return;
        try {
            const liveCounters = await _fetchBusinessLiveCounters(_sidebarAuthHeaders(token));
            const scope = _businessLiveCounterScope(liveCounters || {});
            const scopeLabel = _businessScopeCounterLabel(scope);
            const leadCounters = _businessLiveCounterBucket(liveCounters).leads || {};
            const actionCount = _toSidebarCounterValue(leadCounters.hot);
            const newCount = _toSidebarCounterValue(leadCounters.new);
            const displayCount = actionCount > 0 ? actionCount : newCount;
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
            _setCommandDescription(widget, `${funnelTitle} ${scopeLabel}.`);
            widget.classList.toggle('has-action', actionCount > 0);
            widget.classList.toggle('has-new', actionCount === 0 && newCount > 0);
            _setFocusChipOperationalState(widget, displayCount, { kind: 'leads', hot: actionCount > 0 || newCount > 0 });
            widget.href = '/sales-funnel';
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

    function _getSidebarActiveRole(user = _getCurrentSidebarUser()) {
        try {
            const previewRole = window.RolePreview?.getEffectiveRole?.();
            if (previewRole) return String(previewRole || '').trim();
            const runtimeRole = typeof getUserRole === 'function' ? String(getUserRole() || '').trim() : '';
            return runtimeRole || _getSidebarPrimaryRole(user);
        } catch {
            return _getSidebarPrimaryRole(user);
        }
    }

    function _canSeeSidebarTaskSurface(user = _getCurrentSidebarUser()) {
        const role = _getSidebarActiveRole(user);
        const taskItem = { href: '/tasks', access: 'tasks' };
        return (role ? hasAccess(taskItem, role) : true) && _businessAllowsSidebarItem(taskItem, user);
    }

    function _syncFocusDeckAccess(forceFunnelAccess = null) {
        const deck = document.getElementById('sidebarFocusDeck');
        const tasks = document.getElementById('focusChipTasks');
        const funnel = document.getElementById('focusChipFunnel');
        if (!deck || !tasks || !funnel) return;
        const user = _getCurrentSidebarUser();
        const role = _getSidebarActiveRole(user);
        const leadItem = { href: '/sales-funnel', access: 'leads' };
        const canSeeTasks = _canSeeSidebarTaskSurface(user);
        const canSeeFunnel = forceFunnelAccess === null
            ? ((role ? hasAccess(leadItem, role) : true) && _businessAllowsSidebarItem(leadItem, user))
            : !!forceFunnelAccess;
        tasks.hidden = !canSeeTasks;
        funnel.hidden = !canSeeFunnel;
        deck.classList.toggle('has-tasks', canSeeTasks);
        deck.classList.toggle('has-funnel', canSeeFunnel);
        deck.dataset.visibleCount = String(1 + (canSeeTasks ? 1 : 0) + (canSeeFunnel ? 1 : 0));
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

    function _sidebarAvatarFallback(user) {
        const label = user?.name || user?.username || '?';
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
        return {
            label: initial,
            background: user?.avatar_color || user?.avatarColor || roleColors[user?.role] || colors[(user?.id || 0) % colors.length]
        };
    }

    function _sidebarAvatarCropHash(value) {
        const text = String(value || '');
        let hash = 0;
        for (let index = 0; index < text.length; index += 1) {
            hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
        }
        return Math.abs(hash).toString(36) || '0';
    }

    function _sidebarAvatarCropOwnerCandidates(user) {
        const candidates = [
            user?.id,
            user?.username,
            user?.name,
            'current'
        ];
        const seen = new Set();
        return candidates
            .map(value => String(value || '').trim())
            .filter(value => {
                if (!value || seen.has(value)) return false;
                seen.add(value);
                return true;
            });
    }

    function _normalizeSidebarAvatarCrop(input = {}) {
        const clamp = (value, min, max, fallback) => {
            const number = Number(value);
            if (!Number.isFinite(number)) return fallback;
            return Math.max(min, Math.min(max, number));
        };
        return {
            x: Math.round(clamp(input.x ?? input.positionX, 0, 100, 50)),
            y: Math.round(clamp(input.y ?? input.positionY, 0, 100, 50)),
            zoom: Number(clamp(input.zoom ?? input.scale, 1, 2, 1).toFixed(2))
        };
    }

    function _sidebarAvatarCropStorageKeys(user, photo) {
        const hash = _sidebarAvatarCropHash(photo);
        return _sidebarAvatarCropOwnerCandidates(user).map(owner => `pzp_profile_avatar_crop:${owner}:${hash}`);
    }

    function _sidebarAvatarCropStorageKey(user, photo) {
        return _sidebarAvatarCropStorageKeys(user, photo)[0] || `pzp_profile_avatar_crop:current:${_sidebarAvatarCropHash(photo)}`;
    }

    function _readSidebarAvatarCrop(user, photo) {
        const direct = user?.avatarCrop || user?.avatar_crop;
        const directUrl = user?.avatarCropUrl || user?.avatar_crop_url || '';
        if (direct && typeof direct === 'object' && (!directUrl || directUrl === photo)) {
            return _normalizeSidebarAvatarCrop(direct);
        }
        try {
            for (const key of _sidebarAvatarCropStorageKeys(user, photo)) {
                const raw = localStorage.getItem(key);
                if (raw) return _normalizeSidebarAvatarCrop(JSON.parse(raw));
            }
        } catch {}
        return _normalizeSidebarAvatarCrop();
    }

    function _applySidebarAvatarCrop(img, user, photo) {
        const crop = _readSidebarAvatarCrop(user, photo);
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.objectPosition = `${crop.x}% ${crop.y}%`;
        img.style.transform = `scale(${crop.zoom})`;
        img.style.transformOrigin = `${crop.x}% ${crop.y}%`;
        img.style.display = 'block';
    }

    function _paintUserAvatar(el, user) {
        if (!el || !user) return;
        const photo = user.avatar_url || user.avatarUrl || user.photo_url || user.photoUrl || user.image_url || user.imageUrl;
        const emoji = user.avatar_emoji || user.avatarEmoji;
        const fallback = _sidebarAvatarFallback(user);
        if (photo) {
            el.classList.add('has-photo');
            const img = document.createElement('img');
            img.src = photo;
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            _applySidebarAvatarCrop(img, user, photo);
            img.addEventListener('error', () => {
                el.classList.remove('has-photo');
                el.textContent = fallback.label;
                el.style.background = fallback.background;
            }, { once: true });
            el.replaceChildren(img);
            el.style.background = 'transparent';
            return;
        }
        el.classList.remove('has-photo');
        if (emoji) {
            el.textContent = emoji;
            el.style.background = user.avatar_color || user.avatarColor || '#f59e0b';
            return;
        }
        el.textContent = fallback.label;
        el.style.background = fallback.background;
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

    function _ensureSidebarCollapseButton(sidebar) {
        if (!sidebar) return null;
        const brand = sidebar.querySelector('.sidebar-brand');
        let btn = document.getElementById('sidebarCollapseBtn');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'sidebarCollapseBtn';
            btn.className = 'sidebar-collapse-btn';
        }
        btn.innerHTML = '<span class="collapse-icon" aria-hidden="true">‹</span><span class="collapse-text">Згорнути</span>';
        if (brand && btn.parentElement !== brand) brand.appendChild(btn);
        return btn;
    }

    function _syncSidebarCollapseButton(sidebar) {
        const root = sidebar || document.getElementById('sidebarNav');
        const btn = document.getElementById('sidebarCollapseBtn');
        if (!root || !btn) return;
        const collapsed = root.classList.contains('collapsed');
        const icon = btn.querySelector('.collapse-icon');
        const text = btn.querySelector('.collapse-text');
        if (icon) icon.textContent = collapsed ? '›' : '‹';
        if (text) text.textContent = collapsed ? 'Розгорнути' : 'Згорнути';
        btn.setAttribute('aria-label', collapsed ? 'Розгорнути меню' : 'Згорнути меню');
        btn.setAttribute('title', collapsed ? 'Розгорнути меню' : 'Згорнути меню');
        btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
        document.body.classList.toggle('sidebar-is-collapsed', collapsed);
    }

    function _setSidebarCollapsed(nextCollapsed, persist = true) {
        const sidebar = document.getElementById('sidebarNav');
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed', !!nextCollapsed);
        if (persist) localStorage.setItem('pzp_sidebar_collapsed', String(!!nextCollapsed));
        _syncSidebarCollapseButton(sidebar);
        _syncSidebarBusinessSwitcher();
        _queueActiveIndicatorUpdate();
    }

    function _renderSidebarMiniLink(item, currentPath, currentHash, options = {}) {
        const isActive = _isSidebarItemActive(item, currentPath, currentHash);
        const onclickAttr = item.action
            ? ` onclick="event.preventDefault();if(typeof ${item.action}==='function')${item.action}();"`
            : '';
        const badgeType = _badgeTypeFor(item);
        const kind = options.kind || 'route';
        const meta = _railMetaForItem(item);
        const cue = options.cue || _railRouteCue(item);
        const itemHref = _sidebarHrefForBusinessItem(item);
        const shortLabel = _railShortLabel(item);
        const kindLabel = _railKindLabel(kind);
        return `<a href="${_escAttr(itemHref)}" class="sidebar-mini-link sidebar-mini-link--${_escAttr(kind)}${isActive ? ' active' : ''}" aria-label="${_escAttr(item.label)}"${isActive ? ' aria-current="page"' : ''}${onclickAttr}
            data-sidebar-rail-item
            data-sidebar-rail-kind="${_escAttr(kind)}"
            data-sidebar-rail-title="${_escAttr(item.label)}"
            data-sidebar-rail-meta="${_escAttr(meta)}"
            data-sidebar-rail-cue="${_escAttr(cue)}">
            <span class="sidebar-mini-current" aria-hidden="true"></span>
            ${_renderIcon(item.icon, 'sidebar-mini-icon')}
            <span class="sidebar-mini-label">${_escHtml(shortLabel)}</span>
            <span class="sidebar-mini-hint" aria-hidden="true">${_escHtml(kindLabel)}</span>
            ${badgeType ? `<span class="sidebar-mini-badge" data-badge-type="${badgeType}" style="display:none"></span>` : ''}
        </a>`;
    }

    function _renderSidebarRailSection(kind, label, body) {
        if (!body) return '';
        return `<div class="sidebar-rail-section sidebar-rail-section--${_escAttr(kind)}" role="group" aria-label="${_escAttr(label)}">
            <span class="sidebar-rail-section-title" aria-hidden="true">${_escHtml(label)}</span>
            ${body}
        </div>`;
    }

    function _renderSidebarRailFlyoutButton(groups) {
        if (!groups.length) return '';
        const total = groups.reduce((sum, group) => sum + group.children.length, 0);
        const active = groups.some(group => group.active);
        return `<button type="button" class="sidebar-mini-link sidebar-mini-link--flyout${active ? ' active' : ''}" aria-label="Інші розділи CRM" aria-haspopup="menu" aria-expanded="false"
            data-sidebar-rail-flyout
            data-sidebar-rail-title="Розділи CRM"
            data-sidebar-rail-meta="${_escAttr(`${total} сторінок за вашим доступом`)}"
            data-sidebar-rail-cue="Продажі / продукт / команда / система">
            <span class="sidebar-mini-current" aria-hidden="true"></span>
            ${_renderIcon('system', 'sidebar-mini-icon')}
            <span class="sidebar-mini-label">Меню</span>
            <span class="sidebar-mini-count" aria-hidden="true">${_escHtml(String(total))}</span>
        </button>`;
    }

    function _ensureSidebarMiniRail(role, currentPath, currentHash) {
        const sidebar = document.getElementById('sidebarNav');
        if (!sidebar) return;
        let rail = document.getElementById('sidebarMiniRail');
        if (!rail) {
            rail = document.createElement('nav');
            rail.id = 'sidebarMiniRail';
            rail.className = 'sidebar-mini-rail';
            rail.setAttribute('aria-label', 'Згорнуте меню сторінок');
        }
        const model = _buildUtilityRailModel(role, currentPath, currentHash);
        const favorites = model.favorites.map(item => _renderSidebarMiniLink(item, currentPath, currentHash, { kind: 'favorite', cue: 'Обране' })).join('');
        const primary = model.primary.map(item => _renderSidebarMiniLink(item, currentPath, currentHash, { kind: 'primary' })).join('');
        const utility = _renderSidebarRailFlyoutButton(model.groups);
        rail.innerHTML = [
            _renderSidebarRailSection('favorites', 'Обране', favorites),
            _renderSidebarRailSection('primary', 'Основні маршрути', primary),
            _renderSidebarRailSection('utility', 'Контекстні розділи', utility)
        ].join('');
        const anchor = document.getElementById('sidebarCommandDeck') || sidebar.querySelector('.sidebar-links');
        if (anchor && rail.parentElement !== sidebar) sidebar.insertBefore(rail, anchor);
        else if (!rail.parentElement) sidebar.appendChild(rail);
        _initCollapsedRailInteractions(sidebar);
    }

    // ═══ TOGGLE SIDEBAR (mobile/desktop) ══════════════════════════
    function initToggle() {
        const toggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebarNav');
        const overlay = document.getElementById('sidebarOverlay');
        const collapseBtn = _ensureSidebarCollapseButton(sidebar);
        _ensureCompactProfileAvatar(sidebar);
        if (sidebar) sidebar.dataset.sidebarStateOwner = 'aurora';
        if (sidebar) {
            _setSidebarCollapsed(localStorage.getItem('pzp_sidebar_collapsed') === 'true', false);
        }
        const isMobileSidebar = () => window.matchMedia ? window.matchMedia('(max-width: 768px)').matches : window.innerWidth <= 768;
        const setMobileSidebarOpen = (open) => {
            if (!sidebar) return;
            const nextOpen = Boolean(open);
            sidebar.classList.toggle('open', nextOpen);
            if (overlay) {
                overlay.classList.toggle('hidden', !nextOpen);
                overlay.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
            }
            if (toggle) toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
            document.body.classList.toggle('sidebar-mobile-open', nextOpen);
        };
        if (collapseBtn && sidebar && collapseBtn.dataset.sidebarCollapseBound !== 'true') {
            collapseBtn.dataset.sidebarCollapseOwner = 'aurora';
            collapseBtn.dataset.sidebarCollapseBound = 'true';
            collapseBtn.addEventListener('click', () => {
                _setSidebarCollapsed(!sidebar.classList.contains('collapsed'));
            });
        } else if (collapseBtn) {
            collapseBtn.dataset.sidebarCollapseOwner = 'aurora';
        }
        if (toggle && sidebar) {
            toggle.dataset.sidebarToggleOwner = 'aurora';
            toggle.setAttribute('aria-controls', 'sidebarNav');
            toggle.setAttribute('aria-expanded', sidebar.classList.contains('open') ? 'true' : 'false');
        }
        if (toggle && sidebar && toggle.dataset.sidebarToggleBound !== 'true') {
            toggle.dataset.sidebarToggleBound = 'true';
            let lastPointerToggleAt = 0;
            const toggleMobileSidebar = (event) => {
                const isPointerOpen = event?.type === 'pointerup';
                if (isPointerOpen && !isMobileSidebar()) return;
                if (isPointerOpen) lastPointerToggleAt = Date.now();
                else if (Date.now() - lastPointerToggleAt < 360) {
                    event?.preventDefault?.();
                    event?.stopPropagation?.();
                    return;
                }
                event?.preventDefault?.();
                event?.stopPropagation?.();
                setMobileSidebarOpen(!sidebar.classList.contains('open'));
            };
            toggle.addEventListener('pointerup', toggleMobileSidebar);
            toggle.addEventListener('click', toggleMobileSidebar);
        }
        if (overlay && sidebar && overlay.dataset.sidebarOverlayBound !== 'true') {
            overlay.dataset.sidebarOverlayBound = 'true';
            overlay.setAttribute('aria-hidden', overlay.classList.contains('hidden') ? 'true' : 'false');
            let lastOverlayPointerAt = 0;
            const closeMobileSidebar = (event) => {
                const isPointerClose = event?.type === 'pointerup';
                if (isPointerClose) lastOverlayPointerAt = Date.now();
                else if (Date.now() - lastOverlayPointerAt < 360) {
                    event?.preventDefault?.();
                    event?.stopPropagation?.();
                    return;
                }
                if (!sidebar.classList.contains('open')) return;
                event?.preventDefault?.();
                event?.stopPropagation?.();
                setMobileSidebarOpen(false);
            };
            overlay.addEventListener('pointerup', closeMobileSidebar);
            overlay.addEventListener('click', closeMobileSidebar);
        }
        if (sidebar && sidebar.dataset.sidebarMobileStateBound !== 'true') {
            sidebar.dataset.sidebarMobileStateBound = 'true';
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && sidebar.classList.contains('open')) {
                    setMobileSidebarOpen(false);
                }
            });
            window.addEventListener('resize', () => {
                if (!isMobileSidebar() && sidebar.classList.contains('open')) {
                    setMobileSidebarOpen(false);
                }
            });
        }
        if (sidebar && sidebar.dataset.sidebarLinkBound !== 'true') {
            sidebar.dataset.sidebarLinkBound = 'true';
            sidebar.addEventListener('click', (e) => {
                const link = e.target.closest('.nav-link, .sidebar-quick-nav-link, .focus-chip, .sidebar-primary-action, .sidebar-design-extra-link, .sidebar-mini-link, [data-sidebar-rail-item]');
                if (!link) return;
                if (isMobileSidebar()) setMobileSidebarOpen(false);
            });
        }
        // Desktop collapsed state remains owned by the shared shell controls.
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
    window.addEventListener('rolePreviewChanged', () => {
        const c = document.querySelector('#sidebarLinks') || document.querySelector('#sidebarNav .sidebar-links');
        if (c) render('#' + c.id);
        initUserCard();
    });
    window.addEventListener('crm:alerts-updated', (event) => {
        _renderSidebarAlerts({ alerts: event.detail?.alerts || [] });
    });
    window.addEventListener('crm:tasks-updated', () => {
        _refreshTaskMiniWidget();
    });
    window.addEventListener('crmBusinessContextChanged', () => {
        const c = document.querySelector('#sidebarLinks') || document.querySelector('#sidebarNav .sidebar-links');
        if (c?.id) render('#' + c.id, { refreshOperational: false });
        initUserCard();
        _refreshSidebarOperationalWidgets();
    });
    window.addEventListener('crmBusinessContextHydrated', () => {
        _state.businessSwitching = false;
        const c = document.querySelector('#sidebarLinks') || document.querySelector('#sidebarNav .sidebar-links');
        if (c?.id) render('#' + c.id, { refreshOperational: false });
        initUserCard();
        _refreshSidebarOperationalWidgets();
    });
    window.addEventListener('crmBusinessProfileChanged', () => {
        const c = document.querySelector('#sidebarLinks') || document.querySelector('#sidebarNav .sidebar-links');
        if (c?.id) render('#' + c.id);
        initUserCard();
    });

    // ─── Sidebar action helpers ──────────────────────────────────
    // On timeline (index.html) — open modal directly
    // On other pages — redirect to / with ?open= parameter
    window.sidebarOpenAfisha = function() {
        window.location.href = '/afisha';
    };
    window.sidebarOpenCertificates = function() {
        if (typeof openCertificatesPanel === 'function') {
            openCertificatesPanel();
        } else {
            window.location.href = '/certificates';
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
        refreshTaskMiniWidget: _refreshTaskMiniWidget,
        initUserCard,
        markShellReady: _markShellReady,
        clearShellReady: _clearShellReady,
        NAV_ITEMS,
        SIDEBAR_ACCESS,
        HR_TEAM_BUCKET_VISIBILITY,
        HR_TEAM_BUCKET_VISIBILITY_MANAGERS,
        hasAccess,
        canSeeHrTeamBucket: _canSeeHrTeamBucket,
        canManageHrTeamBucketVisibility: _canManageHrTeamBucketVisibility,
        getMetricTone,
        SIDEBAR_COMPONENTS
    };
})();
