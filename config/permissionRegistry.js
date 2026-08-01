'use strict';

/**
 * Canonical inventory of the access contract.
 *
 * services/accountAccessPolicy.js derives runtime page/action role presets,
 * aliases, validation, and effective capability decisions from this registry.
 */

const ROLE_HIERARCHY = Object.freeze([
    'waiter',
    'dishwasher',
    'maintenance',
    'cleaning',
    'wardrobe',
    'barista',
    'security',
    'reception',
    'animator',
    'pastry_chef',
    'head_pastry',
    'cook',
    'head_chef',
    'instructor',
    'senior_instructor',
    'admin',
    'hr',
    'it_specialist',
    'marketer',
    'art_director',
    'accountant',
    'manager',
    'senior_manager',
    'vice_director',
    'director',
    'creator'
]);

const ALL_STAFF = Object.freeze(ROLE_HIERARCHY.filter(role => role !== 'waiter'));
const MANAGEMENT_UP = Object.freeze(['creator', 'director', 'vice_director', 'senior_manager']);
const MANAGER_UP = Object.freeze([...MANAGEMENT_UP, 'manager']);
const ADMIN_UP = Object.freeze([...MANAGER_UP, 'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin']);
const LEADS_ACCESS = Object.freeze([...MANAGER_UP, 'marketer']);
const ART_ACCESS = Object.freeze([...MANAGER_UP, 'art_director', 'marketer']);
const HERMES_STUDIO_ACCESS = Object.freeze([...MANAGER_UP, 'art_director', 'marketer', 'admin']);
const PROGRAMS_ACCESS = Object.freeze([...MANAGER_UP, 'admin', 'senior_instructor', 'instructor', 'art_director']);
const HR_PAGE_ACCESS = Object.freeze([...MANAGER_UP, 'hr', 'admin', 'security']);
const TRAINING_ACCESS = Object.freeze([...MANAGER_UP, 'hr', 'senior_instructor', 'instructor']);
const GUARDIAN_OPS_ACCESS = Object.freeze(['creator', 'director', 'admin', 'security']);
const FINANCE_ANALYTICS_ACCESS = Object.freeze(['creator', 'director', 'accountant']);
const PAYROLL_VIEW_ROLES = Object.freeze(['creator', 'director', 'vice_director', 'hr', 'accountant']);
const PAYROLL_REVERSE_CLOSE_ROLES = Object.freeze(['creator', 'director', 'accountant']);
const PAYROLL_RULE_ROLES = Object.freeze(['creator', 'director', 'hr', 'accountant']);

const PAGE_STATUS = Object.freeze({
    ACTIVE: 'active',
    BROKEN_ALIAS: 'broken_alias',
    MODAL_SURFACE: 'modal_surface',
    NORMALIZED_PATH: 'normalized_path',
    REDUNDANT: 'redundant',
    SPECIAL_CONTEXT: 'special_context'
});

const ACTION_STATUS = Object.freeze({
    ACTIVE: 'active',
    DEAD: 'dead',
    FRONTEND_ONLY: 'frontend_only',
    PARTIAL: 'partial'
});

function source(file, symbol, options = {}) {
    return Object.freeze({
        file,
        symbol: symbol || null,
        enforces: options.enforces === true,
        notes: options.notes || null
    });
}

function api(file, routeScope, action, notes = null) {
    return Object.freeze({
        file,
        routeScope,
        marker: action ? `requireAction('${action}')` : null,
        enforcement: action ? 'action' : 'independent',
        notes
    });
}

const GENERIC_PAGE_FRONTEND = Object.freeze([
    source('js/auth.js', 'function canAccessPage', { enforces: true })
]);
const GENERIC_PAGE_BACKEND = Object.freeze([
    source('services/accountAccessPolicy.js', 'const PAGE_ACCESS ='),
    source('routes/auth.js', "router.get('/permissions'"),
    source('routes/users.js', "router.get('/roles'")
]);
const GENERIC_ACTION_FRONTEND = Object.freeze([
    source('js/auth.js', 'function resolveCapability')
]);
const GENERIC_ACTION_BACKEND = Object.freeze([
    source('services/accountAccessPolicy.js', 'function resolveCapability'),
    source('middleware/auth.js', 'function requireAction')
]);

function page(definition) {
    return Object.freeze({
        type: 'page',
        aliases: [],
        aliasOf: null,
        sidebarLinks: [],
        frontendConsumers: GENERIC_PAGE_FRONTEND,
        backendConsumers: GENERIC_PAGE_BACKEND,
        apiConsumers: [],
        apiAccessCoupling: 'independent',
        status: PAGE_STATUS.ACTIVE,
        deprecated: false,
        explicitAllow: true,
        replacementKey: null,
        notes: null,
        ...definition,
        defaultRoles: Object.freeze([...(definition.defaultRoles || [])]),
        aliases: Object.freeze([...(definition.aliases || [])]),
        sidebarLinks: Object.freeze([...(definition.sidebarLinks || [])]),
        frontendConsumers: Object.freeze([
            ...GENERIC_PAGE_FRONTEND,
            ...(definition.frontendConsumers || [])
        ]),
        backendConsumers: Object.freeze([
            ...GENERIC_PAGE_BACKEND,
            ...(definition.backendConsumers || [])
        ]),
        apiConsumers: Object.freeze([...(definition.apiConsumers || [])])
    });
}

function action(definition) {
    return Object.freeze({
        type: 'action',
        aliases: [],
        legacyKeys: [],
        frontendConsumers: GENERIC_ACTION_FRONTEND,
        backendConsumers: GENERIC_ACTION_BACKEND,
        apiConsumers: [],
        status: ACTION_STATUS.ACTIVE,
        deprecated: false,
        explicitAllow: true,
        replacementKey: null,
        notes: null,
        delegable: true,
        ...definition,
        defaultRoles: Object.freeze([...(definition.defaultRoles || [])]),
        aliases: Object.freeze([...(definition.aliases || [])]),
        legacyKeys: Object.freeze([...(definition.legacyKeys || [])]),
        frontendConsumers: Object.freeze([
            ...GENERIC_ACTION_FRONTEND,
            ...(definition.frontendConsumers || [])
        ]),
        backendConsumers: Object.freeze([
            ...GENERIC_ACTION_BACKEND,
            ...(definition.backendConsumers || [])
        ]),
        apiConsumers: Object.freeze([...(definition.apiConsumers || [])])
    });
}

const PAGE_PERMISSIONS = Object.freeze([
    page({
        key: '/dashboard', label: 'Дашборд', group: 'today', canonicalPath: '/dashboard',
        defaultRoles: ROLE_HIERARCHY, risk: 'low', status: PAGE_STATUS.REDUNDANT,
        sidebarLinks: ['/dashboard'], frontendConsumers: [source('dashboard.html', 'js/auth.js')],
        apiConsumers: [api('routes/dashboard.js', '/api/dashboard', null)],
        notes: 'Manual page toggle is redundant because every authenticated role is in the default role set.'
    }),
    page({
        key: '/', label: 'Таймлайн', group: 'today', canonicalPath: '/',
        defaultRoles: ALL_STAFF, risk: 'high', sidebarLinks: ['/'],
        frontendConsumers: [source('index.html', 'js/auth.js')],
        apiConsumers: [
            api('routes/bookings.js', '/api/bookings', null),
            api('routes/lines.js', '/api/lines', null),
            api('routes/timeline-resources.js', '/api/timeline-resources', null)
        ],
        notes: 'NAV_ITEMS contains Timeline in two sidebar groups; API authorization is independent of page access.'
    }),
    page({
        key: '/maysternya-doli', label: 'Таймлайн МД', group: 'today', canonicalPath: '/maysternya-doli',
        defaultRoles: ['creator'], explicitAllow: false, risk: 'critical', status: PAGE_STATUS.SPECIAL_CONTEXT,
        sidebarLinks: ['/maysternya-doli'], frontendConsumers: [source('index.html', 'js/auth.js')],
        backendConsumers: [source('server.js', "app.get('/maysternya-doli'")],
        apiConsumers: [api('routes/bookings.js', '/api/bookings?business_context=maysternya_doli', null)],
        notes: 'canAccessPage intentionally ignores pageAllowlist for this business-context shell.'
    }),
    page({
        key: '/tasks', label: 'Задачі', group: 'today', canonicalPath: '/tasks',
        defaultRoles: ALL_STAFF, risk: 'medium', sidebarLinks: ['/tasks'],
        frontendConsumers: [source('tasks.html', 'js/auth.js')],
        apiConsumers: [api('routes/tasks.js', '/api/tasks', null), api('routes/task-templates.js', '/api/task-templates', null)]
    }),
    page({
        key: '/chat', label: 'Чат', group: 'today', canonicalPath: '/chat', aliases: ['/kleshnya'],
        defaultRoles: ALL_STAFF, risk: 'medium', sidebarLinks: ['/chat'],
        frontendConsumers: [source('chat.html', 'js/auth.js')],
        apiConsumers: [api('routes/chat.js', '/api/chat', null), api('routes/kleshnya.js', '/api/kleshnya', null)]
    }),
    page({
        key: '/chat-settings', label: 'Налаштування чату', group: 'system', canonicalPath: '/chat-settings',
        defaultRoles: ['creator', 'director', 'admin'], risk: 'critical',
        frontendConsumers: [source('chat-settings.html', 'js/auth.js')],
        apiConsumers: [api('routes/settings.js', '/api/settings', null), api('routes/guardian.js', '/api/guardian', null)]
    }),
    page({
        key: '/center', label: 'Центр керування', group: 'system', canonicalPath: '/center',
        defaultRoles: MANAGER_UP, risk: 'high', sidebarLinks: ['/center', '/center?tab=tickets'],
        frontendConsumers: [source('center.html', 'js/auth.js')],
        apiConsumers: [api('routes/center.js', '/api/center', null)]
    }),
    page({
        key: '/art', label: 'Арт', group: 'product', canonicalPath: '/art', aliases: ['/art-director', '/art-director.html'],
        defaultRoles: ART_ACCESS, risk: 'medium', sidebarLinks: ['/art'],
        frontendConsumers: [source('art-director.html', 'js/auth.js')],
        apiConsumers: [api('routes/art-director.js', '/api/art-director', null)]
    }),
    page({
        key: '/content', label: 'Контент', group: 'product', canonicalPath: '/content',
        defaultRoles: ART_ACCESS, risk: 'medium', sidebarLinks: ['/content'],
        frontendConsumers: [source('content.html', 'js/auth.js')],
        apiConsumers: [api('routes/content.js', '/api/content', null)]
    }),
    page({
        key: '/designer', label: 'Стайлгайд', group: 'product', canonicalPath: '/designer',
        defaultRoles: ART_ACCESS, risk: 'medium', sidebarLinks: ['/designer'],
        frontendConsumers: [source('designer.html', 'js/auth.js')],
        apiConsumers: [api('routes/designs.js', '/api/designs', null)]
    }),
    page({
        key: '/designs', label: 'Дизайн-борд', group: 'product', canonicalPath: '/designs', aliases: ['/embed/designs'],
        defaultRoles: ART_ACCESS, risk: 'medium', sidebarLinks: ['/designs'],
        frontendConsumers: [source('designs.html', 'js/auth.js')],
        apiConsumers: [api('routes/designs.js', '/api/designs', null)]
    }),
    page({
        key: '/hermes-studio', label: 'Hermes Studio', group: 'product', canonicalPath: '/hermes-studio',
        defaultRoles: HERMES_STUDIO_ACCESS, risk: 'high', sidebarLinks: ['/hermes-studio'],
        frontendConsumers: [source('hermes-studio.html', 'js/auth.js')],
        apiConsumers: [api('routes/hermes-studio.js', '/api/hermes-studio', null)],
        notes: 'This page permission does not grant access to the API-key-authenticated Hermes integration.'
    }),
    page({
        key: '/graduation', label: 'Випускний', group: 'product', canonicalPath: '/graduation', aliases: ['/embed/graduation'],
        defaultRoles: [...MANAGER_UP, 'admin', 'art_director', 'marketer'], risk: 'medium', sidebarLinks: ['/graduation'],
        frontendConsumers: [source('graduation.html', 'js/auth.js')],
        apiConsumers: [api('routes/graduation.js', '/api/graduation', null)]
    }),
    page({
        key: '/customers', label: 'Клієнти', group: 'sales', canonicalPath: '/customers',
        defaultRoles: [...ADMIN_UP, 'reception'], risk: 'high', sidebarLinks: ['/customers'],
        frontendConsumers: [source('customers.html', 'js/auth.js')],
        apiConsumers: [api('routes/customers.js', '/api/customers', null), api('routes/loyalty.js', '/api/loyalty', null)]
    }),
    page({
        key: '/staff', label: 'Графік персоналу', group: 'team', canonicalPath: '/staff',
        defaultRoles: ALL_STAFF, risk: 'high', sidebarLinks: ['/staff'],
        frontendConsumers: [source('staff.html', 'js/auth.js')],
        apiConsumers: [api('routes/staff.js', '/api/staff', null)]
    }),
    page({
        key: '/warehouse', label: 'Склад', group: 'system', canonicalPath: '/warehouse',
        defaultRoles: [...MANAGER_UP, 'admin'], risk: 'high', sidebarLinks: ['/warehouse'],
        frontendConsumers: [source('warehouse.html', 'js/auth.js')],
        apiConsumers: [api('routes/warehouse.js', '/api/warehouse', null), api('routes/procurement.js', '/api/procurement', null)]
    }),
    page({
        key: '/training', label: 'Навчання', group: 'team', canonicalPath: '/training',
        defaultRoles: TRAINING_ACCESS, risk: 'medium', sidebarLinks: ['/training'],
        frontendConsumers: [source('training.html', 'js/auth.js')],
        apiConsumers: [api('routes/training.js', '/api/training', null)]
    }),
    page({
        key: '/timeline-settings', label: 'Налаштування таймлайну', group: 'system', canonicalPath: '/timeline-settings',
        defaultRoles: ['creator', 'director'], risk: 'critical', sidebarLinks: ['/timeline-settings'],
        frontendConsumers: [source('timeline-settings.html', 'js/auth.js')],
        apiConsumers: [api('routes/settings.js', '/api/settings', null), api('routes/timeline-resources.js', '/api/timeline-resources', null)]
    }),
    page({
        key: '/booking-summary.html', label: 'Підсумок бронювання', group: 'system', canonicalPath: '/booking-summary.html',
        aliases: ['/booking-summary'], defaultRoles: ALL_STAFF, risk: 'high',
        frontendConsumers: [source('booking-summary.html', 'js/auth.js')],
        backendConsumers: [source('server.js', "app.get('/booking-summary.html'")],
        apiConsumers: [api('routes/bookings.js', '/api/bookings', null), api('routes/summary.js', '/api/summary', null)],
        notes: 'The canonical permission key matches the served /booking-summary.html route; /booking-summary remains a compatibility alias.'
    }),
    page({
        key: '/demo', label: 'Demo', group: 'system', canonicalPath: '/demo',
        defaultRoles: MANAGER_UP, risk: 'medium', sidebarLinks: ['/demo'],
        frontendConsumers: [source('demo.html', 'js/auth.js')],
        apiConsumers: [api('routes/demo.js', '/api/demo', null)]
    }),
    page({
        key: '/programs', label: 'Продукти', group: 'product', canonicalPath: '/programs', aliases: ['/embed/programs'],
        defaultRoles: PROGRAMS_ACCESS, risk: 'high',
        sidebarLinks: ['/programs', '/programs#animation', '/programs#kitchen-cakes', '/programs#kitchen-menu', '/programs#catalogs'],
        frontendConsumers: [source('programs.html', 'js/auth.js')],
        apiConsumers: [api('routes/products.js', '/api/products', null), api('routes/packages.js', '/api/packages', null), api('routes/catalogs.js', '/api/catalogs', null)]
    }),
    page({
        key: '/hr', label: 'HR', group: 'team', canonicalPath: '/hr',
        defaultRoles: HR_PAGE_ACCESS, risk: 'critical',
        sidebarLinks: ['/hr', '/hr#team', '/hr#structure', '/hr#payroll', '/hr#other'],
        frontendConsumers: [source('hr.html', 'js/auth.js'), source('js/hr-page.js', 'function activateHrTab')],
        backendConsumers: [source('routes/hr.js', 'function requireHrCapabilityContract')],
        apiConsumers: [api('routes/hr.js', '/api/hr', null), api('routes/users.js', '/api/users', null), api('routes/payroll.js', '/api/payroll', null)],
        notes: 'The /hr page opens the shell; granular HR capabilities govern every tab and API operation.'
    }),
    page({
        key: '/checkin', label: 'Check-in', group: 'team', canonicalPath: '/checkin',
        defaultRoles: HR_PAGE_ACCESS, risk: 'high', sidebarLinks: ['/checkin'],
        frontendConsumers: [source('checkin.html', 'js/auth.js')],
        apiConsumers: [api('routes/hr.js', '/api/hr', null)]
    }),
    page({
        key: '/finance', label: 'Фінанси та аналітика', group: 'sales', canonicalPath: '/finance', aliases: ['/analytics'],
        defaultRoles: FINANCE_ANALYTICS_ACCESS, explicitAllow: false, risk: 'critical', sidebarLinks: ['/finance'],
        frontendConsumers: [source('finance.html', 'js/auth.js')],
        apiConsumers: [api('routes/finance.js', '/api/finance', null), api('routes/analytics.js', '/api/analytics', null), api('routes/payroll.js', '/api/payroll', null)]
    }),
    page({
        key: '/accounting-deposits', label: 'Перевірка завдатків', group: 'sales', canonicalPath: '/accounting-deposits',
        defaultRoles: FINANCE_ANALYTICS_ACCESS, risk: 'critical', sidebarLinks: ['/accounting-deposits'],
        frontendConsumers: [source('accounting-deposits.html', 'js/auth.js')],
        apiConsumers: [api('routes/finance.js', '/api/finance', null), api('routes/banquet-deposits.js', '/api/banquet-deposits', null)]
    }),
    page({
        key: '/status', label: 'Статус', group: 'system', canonicalPath: '/status',
        defaultRoles: MANAGER_UP, risk: 'medium', frontendConsumers: [source('status.html', 'js/auth.js')],
        apiConsumers: [api('routes/status.js', '/api/status', null), api('routes/page-statuses.js', '/api/page-statuses', null)]
    }),
    page({
        key: '/guardian-ops', label: 'Guardian Ops', group: 'system', canonicalPath: '/guardian-ops',
        defaultRoles: GUARDIAN_OPS_ACCESS, risk: 'critical', sidebarLinks: ['/guardian-ops'],
        frontendConsumers: [source('guardian-ops.html', 'js/auth.js')],
        apiConsumers: [api('routes/guardian.js', '/api/guardian', null)]
    }),
    page({
        key: '/omni', label: 'Комунікації', group: 'sales', canonicalPath: '/omni',
        defaultRoles: MANAGER_UP, risk: 'high', sidebarLinks: ['/omni', '/omni#accounts'],
        frontendConsumers: [source('omni.html', 'js/auth.js')],
        apiConsumers: [api('routes/omnichannel.js', '/api/omni', null)]
    }),
    page({
        key: '/copilot', label: 'AI менеджер', group: 'sales', canonicalPath: '/copilot',
        defaultRoles: MANAGER_UP, risk: 'high', sidebarLinks: ['/copilot'],
        frontendConsumers: [source('copilot.html', 'js/auth.js')],
        apiConsumers: [api('routes/copilot.js', '/api/copilot', null)]
    }),
    page({
        key: '/sound', label: 'Звук', group: 'product', canonicalPath: '/sound',
        defaultRoles: [...MANAGER_UP, 'art_director'], risk: 'medium',
        sidebarLinks: ['/sound#projects', '/sound#library', '/sound#announcements'],
        frontendConsumers: [source('sound.html', 'js/auth.js')],
        apiConsumers: [api('routes/sound-library.js', '/api/sound-library', null), api('routes/music.js', '/api/music', null)]
    }),
    page({
        key: '/afisha', label: 'Афіша', group: 'product', canonicalPath: '/afisha',
        defaultRoles: ALL_STAFF, risk: 'medium', sidebarLinks: ['/afisha'],
        frontendConsumers: [source('afisha.html', 'js/auth.js')],
        apiConsumers: [api('routes/afisha.js', '/api/afisha', null)]
    }),
    page({
        key: '/certificates', label: 'Сертифікати', group: 'product', canonicalPath: '/certificates',
        defaultRoles: ALL_STAFF, risk: 'high', sidebarLinks: ['/certificates'],
        frontendConsumers: [source('certificates.html', 'js/auth.js')],
        apiConsumers: [api('routes/certificates.js', '/api/certificates', null)]
    }),
    page({
        key: '/certificates/new', label: 'Видати сертифікат або абонемент', group: 'product', canonicalPath: '/certificates/new',
        defaultRoles: ALL_STAFF, risk: 'high', sidebarLinks: ['/certificates/new'],
        frontendConsumers: [source('certificates.html', 'js/auth.js')],
        apiConsumers: [api('routes/certificates.js', '/api/certificates', null)]
    }),
    page({
        key: '/certificates/batch', label: 'Пакет сертифікатів', group: 'product', canonicalPath: '/certificates/batch',
        defaultRoles: ALL_STAFF, risk: 'high', sidebarLinks: ['/certificates/batch'],
        frontendConsumers: [source('certificates.html', 'js/auth.js')],
        apiConsumers: [api('routes/certificates.js', '/api/certificates', null)]
    }),
    page({
        key: '/sales-funnel', label: 'Ліди', group: 'sales', canonicalPath: '/sales-funnel', aliases: ['/leads'],
        defaultRoles: LEADS_ACCESS, risk: 'high', sidebarLinks: ['/sales-funnel'],
        frontendConsumers: [source('leads.html', 'js/auth.js')],
        apiConsumers: [api('routes/leads.js', '/api/leads', null), api('routes/sales.js', '/api/sales', null)]
    }),
    page({
        key: '/report-agent', label: 'Звіт-агент', group: 'sales', canonicalPath: '/report-agent',
        defaultRoles: ['creator', 'director', 'vice_director'], risk: 'high',
        frontendConsumers: [source('report-agent.html', 'js/auth.js')],
        apiConsumers: [api('routes/report-bot.js', '/api/report-bot', null), api('routes/agents.js', '/api/agents', null)]
    }),
    page({
        key: '/reports', label: 'Звіти', group: 'sales', canonicalPath: '/reports',
        defaultRoles: ['creator', 'director', 'vice_director', 'senior_manager', 'accountant'], risk: 'critical',
        sidebarLinks: ['/reports'], frontendConsumers: [source('reports.html', 'js/auth.js')],
        apiConsumers: [api('routes/reports.js', '/api/reports', null)]
    }),
    page({
        key: '/game', label: 'Гра', group: 'personal', canonicalPath: '/game',
        defaultRoles: ROLE_HIERARCHY, risk: 'low', status: PAGE_STATUS.REDUNDANT,
        sidebarLinks: ['/game'], frontendConsumers: [source('game.html', 'js/auth.js')],
        apiConsumers: [api('routes/minigame.js', '/api/minigame', null), api('routes/gamification.js', '/api/gamification', null)]
    }),
    page({
        key: '/profile', label: 'Профіль', group: 'personal', canonicalPath: '/profile',
        defaultRoles: ROLE_HIERARCHY, risk: 'medium', status: PAGE_STATUS.REDUNDANT,
        frontendConsumers: [source('profile.html', 'js/auth.js')],
        apiConsumers: [api('routes/personal-accounts.js', '/api/personal-accounts', null), api('routes/achievements.js', '/api/achievements', null)]
    }),
    page({
        key: '/quiz', label: 'Квіз', group: 'personal', canonicalPath: '/quiz',
        defaultRoles: ROLE_HIERARCHY, risk: 'low', status: PAGE_STATUS.REDUNDANT,
        frontendConsumers: [source('quiz.html', 'js/auth.js')],
        apiConsumers: [api('routes/quiz.js', '/api/quiz', null)]
    }),
    page({
        key: '/room', label: 'Кімната', group: 'personal', canonicalPath: '/room',
        defaultRoles: ROLE_HIERARCHY, risk: 'low', status: PAGE_STATUS.REDUNDANT,
        frontendConsumers: [source('room.html', 'js/auth.js')],
        apiConsumers: [api('routes/room.js', '/api/room', null)]
    }),
    page({
        key: '/shop', label: 'Магазин', group: 'personal', canonicalPath: '/shop',
        defaultRoles: ROLE_HIERARCHY, risk: 'low', status: PAGE_STATUS.REDUNDANT,
        frontendConsumers: [source('shop.html', 'js/auth.js')],
        apiConsumers: [api('routes/shop.js', '/api/shop', null)]
    })
]);

const ACTION_PERMISSIONS = Object.freeze([
    action({
        key: 'hr.today.view', label: 'Перегляд HR: Сьогодні', group: 'hr', defaultRoles: HR_PAGE_ACCESS, risk: 'high',
        backendConsumers: [source('routes/hr.js', 'function requireHrCapabilityContract', { enforces: true })],
        frontendConsumers: [source('js/hr-page.js', "'hr.today.view'", { enforces: true })], apiConsumers: [api('routes/hr.js', '/api/hr/today', null, 'Enforced by requireHrCapabilityContract.')]
    }),
    action({
        key: 'hr.schedule.view', label: 'Перегляд HR-графіка', group: 'hr', defaultRoles: ALL_STAFF, risk: 'high',
        backendConsumers: [source('routes/hr.js', 'function requireHrCapabilityContract', { enforces: true })],
        frontendConsumers: [source('js/hr-page.js', "'hr.schedule.view'", { enforces: true }), source('js/hr-pulse-switcher.js', "'hr.schedule.view'", { enforces: true }), source('js/staff-page.js', "canUseStaffCapability('hr.schedule.view')", { enforces: true })],
        apiConsumers: [api('routes/hr.js', '/api/hr/shifts', null, 'Enforced by requireHrCapabilityContract.'), api('routes/staff.js', '/api/staff/schedule and shift-preferences reads', 'hr.schedule.view')]
    }),
    action({
        key: 'hr.schedule.manage', label: 'Керування HR-графіком', group: 'hr', defaultRoles: [...MANAGER_UP, 'hr', 'admin'], legacyKeys: ['manage_staff'], risk: 'critical',
        backendConsumers: [source('routes/hr.js', 'function requireHrCapabilityContract', { enforces: true })],
        frontendConsumers: [source('js/hr-page.js', "'hr.schedule.manage'", { enforces: true }), source('js/staff-page.js', "canUseStaffCapability('hr.schedule.manage')", { enforces: true })], apiConsumers: [api('routes/hr.js', '/api/hr schedule mutations', null, 'Enforced by requireHrCapabilityContract.'), api('routes/staff.js', '/api/staff schedule mutations', 'hr.schedule.manage')]
    }),
    action({
        key: 'hr.staff.view', label: 'Перегляд HR-даних персоналу', group: 'hr', defaultRoles: HR_PAGE_ACCESS, risk: 'high',
        backendConsumers: [source('routes/hr.js', 'function requireHrCapabilityContract', { enforces: true })],
        frontendConsumers: [source('js/hr-page.js', "'hr.staff.view'", { enforces: true }), source('js/staff-page.js', "canUseStaffCapability('hr.staff.view')", { enforces: true })], apiConsumers: [api('routes/hr.js', '/api/hr/staff and structure reads', null, 'Enforced by requireHrCapabilityContract.')]
    }),
    action({
        key: 'hr.staff.manage', label: 'Керування HR-даними персоналу', group: 'hr', defaultRoles: [...MANAGER_UP, 'hr', 'admin'], legacyKeys: ['manage_staff'], risk: 'critical',
        backendConsumers: [source('routes/hr.js', 'function requireHrCapabilityContract', { enforces: true })],
        frontendConsumers: [source('js/hr-page.js', "'hr.staff.manage'", { enforces: true }), source('js/staff-page.js', "canUseStaffCapability('hr.staff.manage')", { enforces: true })], apiConsumers: [api('routes/hr.js', '/api/hr staff mutations', null, 'Enforced by requireHrCapabilityContract.'), api('routes/staff.js', '/api/staff profile mutations', 'hr.staff.manage')]
    }),
    action({
        key: 'hr.reports.view', label: 'Перегляд HR-звітів', group: 'hr', defaultRoles: HR_PAGE_ACCESS, risk: 'critical',
        backendConsumers: [source('routes/hr.js', 'function requireHrCapabilityContract', { enforces: true })],
        frontendConsumers: [source('js/hr-page.js', "'hr.reports.view'", { enforces: true }), source('js/hr-pulse-switcher.js', "'hr.reports.view'", { enforces: true })], apiConsumers: [api('routes/hr.js', '/api/hr/report', null, 'Enforced by requireHrCapabilityContract.')]
    }),
    action({
        key: 'hr.reports.export', label: 'Експорт HR-звітів', group: 'hr', defaultRoles: HR_PAGE_ACCESS, risk: 'critical',
        backendConsumers: [source('routes/hr.js', 'function requireHrCapabilityContract', { enforces: true })],
        frontendConsumers: [source('js/hr-page.js', "'hr.reports.export'", { enforces: true })], apiConsumers: [api('routes/hr.js', '/api/hr/report/export', null, 'Enforced by requireHrCapabilityContract.')]
    }),
    action({
        key: 'hr.payroll.view', label: 'Перегляд зарплатних даних HR', group: 'payroll', defaultRoles: PAYROLL_VIEW_ROLES, legacyKeys: ['view_payroll'], risk: 'critical',
        backendConsumers: [source('routes/hr.js', 'function requireHrCapabilityContract', { enforces: true })],
        frontendConsumers: [source('js/hr-page.js', "'hr.payroll.view'", { enforces: true })], apiConsumers: [api('routes/hr.js', '/api/hr payroll reads', null, 'Enforced by requireHrCapabilityContract.'), api('routes/staff.js', '/api/staff/payroll', 'hr.payroll.view')]
    }),
    action({
        key: 'hr.payroll.manage', label: 'Керування зарплатними даними HR', group: 'payroll', defaultRoles: PAYROLL_VIEW_ROLES, legacyKeys: ['manage_payroll_accrual'], risk: 'critical',
        backendConsumers: [source('routes/hr.js', 'function requireHrCapabilityContract', { enforces: true })],
        frontendConsumers: [source('js/hr-page.js', "'hr.payroll.manage'", { enforces: true })], apiConsumers: [api('routes/hr.js', '/api/hr payroll mutations', null, 'Enforced by requireHrCapabilityContract.')]
    }),    action({
        key: 'finance.manage', label: 'Керування фінансовими транзакціями', group: 'finance', defaultRoles: FINANCE_ANALYTICS_ACCESS, risk: 'critical',
        backendConsumers: [source('routes/finance.js', "const requireFinanceManagement = requireAction('finance.manage');", { enforces: true })],
        explicitAllow: false,
        frontendConsumers: [source('js/finance-page.js', "financeCanManageTransactions()", { enforces: true })],
        apiConsumers: [api('routes/finance.js', '/api/finance mutating endpoints', 'finance.manage', 'Applies to every POST, PUT, PATCH and DELETE request before payroll and account-specific guards.')]
    }),
    action({
        key: 'create_booking', label: 'Створювати бронювання', group: 'bookings',
        defaultRoles: [...ADMIN_UP, 'reception'], risk: 'high',
        frontendConsumers: [source('js/auth.js', "canAccess('create_booking')", { enforces: true })],
        apiConsumers: [api('routes/bookings.js', '/api/bookings create endpoints', 'create_booking')]
    }),
    action({
        key: 'edit_booking', label: 'Редагувати бронювання', group: 'bookings',
        defaultRoles: [...ADMIN_UP, 'reception'], risk: 'high',
        frontendConsumers: [
            source('js/booking.js', "canAccess('edit_booking')", { enforces: true }),
            source('js/timeline.js', "canAccess('edit_booking')", { enforces: true }),
            source('js/leads-page.js', "canAccess('edit_booking')", { enforces: true })
        ],
        backendConsumers: [source('services/bookingVisibility.js', "canUseAction(user, 'edit_booking')", { enforces: true })],
        apiConsumers: [
            api('routes/bookings.js', '/api/bookings edit endpoints', 'edit_booking'),
            api('routes/banquets.js', '/api/banquets booking endpoints', 'edit_booking')
        ],
    }),
    action({
        key: 'cancel_booking', label: 'Скасовувати бронювання', group: 'bookings',
        defaultRoles: MANAGER_UP, risk: 'high', status: ACTION_STATUS.DEAD, deprecated: true,
        replacementKey: 'delete_booking',
        notes: 'No endpoint or feature-specific frontend consumer enforces this action; cancellation uses other guards.'
    }),
    action({
        key: 'delete_booking', label: 'Видаляти бронювання', group: 'bookings',
        defaultRoles: ADMIN_UP, risk: 'critical',
        frontendConsumers: [source('js/booking.js', "canAccess('delete_booking')", { enforces: true })],
        apiConsumers: [api('routes/bookings.js', '/api/bookings delete and series-cancel endpoints', 'delete_booking')],
    }),
    action({
        key: 'manage_accounts', label: 'Керувати акаунтами', group: 'accounts',
        defaultRoles: ['creator', 'director'], risk: 'critical', delegable: false,
        frontendConsumers: [source('js/hr-page.js', "canAccess('manage_accounts')", { enforces: true })],
        apiConsumers: [
            api('routes/users.js', '/api/users account lifecycle', 'manage_accounts'),
            api('routes/auth.js', '/api/auth impersonate and users-list', 'manage_accounts'),
            api('routes/staff.js', '/api/staff account links', 'manage_accounts'),
            api('routes/employees.js', '/api/employees account links', 'manage_accounts')
        ]
    }),
    action({
        key: 'view_all', label: 'Бачити всі записи', group: 'record_scope',
        defaultRoles: [...ADMIN_UP, 'reception'], risk: 'critical',
        backendConsumers: [source('services/bookingVisibility.js', "canUseAction(user, 'view_all')", { enforces: true })]
    }),
    action({
        key: 'view_own', label: 'Бачити свої записи', group: 'record_scope',
        defaultRoles: ['senior_instructor', 'instructor', 'animator', 'reception'], risk: 'high',
        status: ACTION_STATUS.DEAD, deprecated: true,
        notes: 'No feature-specific frontend or backend enforcement consumer was found.'
    }),
    action({
        key: 'manage_users', label: 'Керувати користувачами', group: 'accounts',
        defaultRoles: ['creator', 'director'], risk: 'critical', delegable: false,
        status: ACTION_STATUS.DEAD, deprecated: true, replacementKey: 'manage_accounts',
        notes: 'Account endpoints use manage_accounts; this key remains in self-lockout invariants only.'
    }),
    action({
        key: 'view_revenue', label: 'Бачити виручку', group: 'finance',
        defaultRoles: [...MANAGER_UP, 'accountant'], risk: 'critical',
        status: ACTION_STATUS.FRONTEND_ONLY, deprecated: true,
        frontendConsumers: [source('js/booking.js', "canAccess('view_revenue')", { enforces: true })],
        notes: 'UI masking exists, but no matching server-side data guard was found.'
    }),
    action({
        key: 'manage_settings', label: 'Керувати налаштуваннями', group: 'system',
        defaultRoles: ['creator', 'director'], risk: 'critical', delegable: false,
        status: ACTION_STATUS.FRONTEND_ONLY, deprecated: true,
        frontendConsumers: [source('js/auth.js', "canAccess('manage_settings')", { enforces: true })],
        notes: 'UI visibility exists, while settings APIs use independent role/route guards.'
    }),
    action({
        key: 'export_data', label: 'Експорт даних', group: 'data',
        defaultRoles: MANAGER_UP, risk: 'critical', status: ACTION_STATUS.FRONTEND_ONLY, deprecated: true,
        frontendConsumers: [
            source('js/auth.js', "canAccess('export_data')", { enforces: true }),
            source('js/app.js', "canAccess('export_data')", { enforces: true })
        ],
        notes: 'Several export endpoints do not enforce this action server-side.'
    }),
    action({
        key: 'manage_staff', label: 'Керувати персоналом', group: 'hr',
        defaultRoles: [...MANAGER_UP, 'hr', 'admin'], risk: 'critical',
        frontendConsumers: [source('js/hr-page.js', "canAccess('manage_staff')", { enforces: true }), source('js/training-page.js', "canUseAction('manage_staff')", { enforces: true })],
        backendConsumers: [source('routes/hermes-schedule.js', "canUseAction(req.user, 'manage_staff')", { enforces: true }), source('routes/training.js', "canUseAction(req.user, 'manage_staff')", { enforces: true })],
        apiConsumers: [
            api('routes/hr.js', '/api/hr management endpoints', null, 'Replaced by granular HR capabilities.'),
            api('routes/staff.js', '/api/staff schedule and profile mutations', null, 'Schedule writes use hr.schedule.manage; profile writes use hr.staff.manage.'),
            api('routes/hermes-schedule.js', '/api/hermes schedule mutations', null, 'Uses canUseAction instead of requireAction.'),
            api('routes/training.js', '/api/training managed progress', null, 'Uses canUseAction instead of requireAction.')
        ],
    }),
    action({
        key: 'view_payroll', label: 'Перегляд зарплати', group: 'payroll',
        defaultRoles: PAYROLL_VIEW_ROLES, risk: 'critical',
        frontendConsumers: [source('js/hr-page.js', "hrCanUsePayrollAction('view_payroll')", { enforces: true })],
        apiConsumers: [api('routes/hr.js', '/api/hr payroll reads', null, 'Replaced by hr.payroll.view.'), api('routes/payroll.js', '/api/payroll read/export endpoints', 'view_payroll')]
    }),
    action({
        key: 'manage_payroll_accrual', label: 'Керувати нарахуваннями', group: 'payroll',
        defaultRoles: PAYROLL_VIEW_ROLES, risk: 'critical',
        frontendConsumers: [source('js/hr-page.js', "hrCanUsePayrollAction('manage_payroll_accrual')", { enforces: true }), source('js/finance-page.js', "financeCanUsePayrollAction('manage_payroll_accrual')", { enforces: true })],
        apiConsumers: [api('routes/hr.js', '/api/hr payroll accrual', 'manage_payroll_accrual'), api('routes/payroll.js', '/api/payroll accrual endpoints', 'manage_payroll_accrual')]
    }),
    action({
        key: 'approve_payroll_installment', label: 'Погоджувати виплату', group: 'payroll',
        defaultRoles: PAYROLL_VIEW_ROLES, risk: 'critical',
        frontendConsumers: [source('js/hr-page.js', "hrCanUsePayrollAction('approve_payroll_installment')", { enforces: true }), source('js/finance-page.js', "financeCanUsePayrollAction('approve_payroll_installment')", { enforces: true })],
        apiConsumers: [api('routes/hr.js', '/api/hr payroll approval', 'approve_payroll_installment'), api('routes/payroll.js', '/api/payroll installments approval', 'approve_payroll_installment')]
    }),
    action({
        key: 'confirm_payroll_payment', label: 'Підтверджувати виплату', group: 'payroll',
        defaultRoles: PAYROLL_VIEW_ROLES, risk: 'critical',
        frontendConsumers: [source('js/hr-page.js', "hrCanUsePayrollAction('confirm_payroll_payment')", { enforces: true }), source('js/finance-page.js', "financeCanUsePayrollAction('confirm_payroll_payment')", { enforces: true })],
        apiConsumers: [api('routes/payroll.js', '/api/payroll payment confirmation', 'confirm_payroll_payment')]
    }),
    action({
        key: 'reverse_payroll_payment', label: 'Сторнувати виплату', group: 'payroll',
        defaultRoles: PAYROLL_REVERSE_CLOSE_ROLES, risk: 'critical',
        frontendConsumers: [source('js/hr-page.js', "hrCanUsePayrollAction('reverse_payroll_payment')", { enforces: true }), source('js/finance-page.js', "financeCanUsePayrollAction('reverse_payroll_payment')", { enforces: true })],
        apiConsumers: [api('routes/hr.js', '/api/hr payroll reversal', 'reverse_payroll_payment'), api('routes/payroll.js', '/api/payroll payment reversal', 'reverse_payroll_payment')]
    }),
    action({
        key: 'close_payroll_period', label: 'Закривати зарплатний період', group: 'payroll',
        defaultRoles: PAYROLL_REVERSE_CLOSE_ROLES, risk: 'critical',
        frontendConsumers: [source('js/hr-page.js', "hrCanUsePayrollAction('close_payroll_period')", { enforces: true })],
        apiConsumers: [api('routes/hr.js', '/api/hr payroll period close', 'close_payroll_period'), api('routes/payroll.js', '/api/payroll period close', 'close_payroll_period')]
    }),
    action({
        key: 'manage_payroll_rules', label: 'Керувати правилами зарплати', group: 'payroll',
        defaultRoles: PAYROLL_RULE_ROLES, risk: 'critical',
        frontendConsumers: [source('js/finance-page.js', "financeCanUsePayrollAction('manage_payroll_rules')", { enforces: true })],
        apiConsumers: [api('routes/hr.js', '/api/hr payroll rules', 'manage_payroll_rules'), api('routes/payroll.js', '/api/payroll schemes', 'manage_payroll_rules')]
    })
]);

function hrTab(definition) {
    return Object.freeze({
        pageKey: '/hr',
        aliases: [],
        additionalActions: [],
        frontendActions: [],
        backendActions: [],
        sidebarLinks: [],
        apiConsumers: [],
        risk: 'high',
        ...definition,
        aliases: Object.freeze([...(definition.aliases || [])]),
        additionalActions: Object.freeze([...(definition.additionalActions || [])]),
        frontendActions: Object.freeze([...(definition.frontendActions || [])]),
        backendActions: Object.freeze([...(definition.backendActions || [])]),
        sidebarLinks: Object.freeze([...(definition.sidebarLinks || [])]),
        apiConsumers: Object.freeze([...(definition.apiConsumers || [])])
    });
}

const HR_TABS = Object.freeze([
    hrTab({ id: 'today', additionalActions: ['hr.today.view'], frontendActions: ['hr.today.view'], backendActions: ['hr.today.view'], label: 'Сьогодні', group: 'pulse', aliases: ['ai-team'], sidebarLinks: ['/hr', '/hr#today'], frontendConsumer: source('js/hr-page.js', 'loadToday'), apiConsumers: [api('routes/hr.js', '/api/hr/today and attendance status', null)] }),
    hrTab({ id: 'schedule', additionalActions: ['hr.schedule.view'], frontendActions: ['hr.schedule.view'], backendActions: ['hr.schedule.view'], label: 'Графік', group: 'pulse', aliases: ['leaves'], sidebarLinks: ['/hr#schedule', '/staff'], frontendConsumer: source('js/hr-page.js', 'loadHrScheduleModule'), apiConsumers: [api('routes/hr.js', '/api/hr/shifts', null), api('routes/staff.js', '/api/staff/schedule', null)] }),
    hrTab({ id: 'reports', additionalActions: ['hr.reports.view', 'hr.reports.export'], frontendActions: ['hr.reports.view'], backendActions: ['hr.reports.view'], label: 'Звіти', group: 'pulse', sidebarLinks: ['/hr#reports'], risk: 'critical', frontendConsumer: source('js/hr-page.js', 'loadReports'), apiConsumers: [api('routes/hr.js', '/api/hr/report', null)] }),
    hrTab({ id: 'team', additionalActions: ['hr.staff.view'], frontendActions: ['hr.staff.view'], backendActions: ['hr.staff.view'], label: 'Команда', group: 'people', aliases: ['workers', 'interns', 'reserve', 'blacklist', 'dismissed', 'fired', 'terminated'], sidebarLinks: ['/hr#team'], risk: 'critical', frontendConsumer: source('js/hr-page.js', 'loadTeam'), apiConsumers: [api('routes/hr.js', '/api/hr/staff', null)] }),
    hrTab({ id: 'structure', additionalActions: ['hr.staff.view'], frontendActions: ['hr.staff.view'], backendActions: ['hr.staff.view'], label: 'Структура', group: 'structure', sidebarLinks: ['/hr#structure'], frontendConsumer: source('js/hr-page.js', 'loadCompanyStructure'), apiConsumers: [api('routes/hr.js', '/api/hr/company-structure', null)] }),
    hrTab({ id: 'professions', additionalActions: ['hr.staff.view'], frontendActions: ['hr.staff.view'], backendActions: ['hr.staff.view'], label: 'Професії', group: 'structure', frontendConsumer: source('js/hr-page.js', 'loadProfessions'), apiConsumers: [api('routes/hr.js', '/api/hr/professions', null)] }),
    hrTab({ id: 'checklists', additionalActions: ['hr.staff.view'], frontendActions: ['hr.staff.view'], backendActions: ['hr.staff.view'], label: 'Чеклісти', group: 'structure', frontendConsumer: source('js/hr-page.js', 'loadProfessionChecklists'), apiConsumers: [api('routes/hr.js', '/api/hr/profession-checklists', null)] }),
    hrTab({ id: 'accounts', label: 'Акаунти', group: 'structure', additionalActions: ['manage_accounts'], frontendActions: ['manage_accounts'], backendActions: ['manage_accounts'], risk: 'critical', frontendConsumer: source('js/hr-page.js', 'loadAccountCenter'), apiConsumers: [api('routes/users.js', '/api/users', 'manage_accounts')] }),
    hrTab({ id: 'salary', label: 'Зарплата', group: 'payroll', aliases: ['payroll'], additionalActions: ['hr.payroll.view', 'view_payroll'], frontendActions: ['hr.payroll.view'], backendActions: ['hr.payroll.view'], sidebarLinks: ['/hr#payroll'], risk: 'critical', frontendConsumer: source('js/hr-page.js', 'loadSalary'), apiConsumers: [api('routes/hr.js', '/api/hr/payroll', 'hr.payroll.view'), api('routes/payroll.js', '/api/payroll', 'view_payroll')] }),
    hrTab({ id: 'profiles', label: 'Профілі зарплати', group: 'payroll', additionalActions: ['hr.payroll.view', 'view_payroll', 'manage_payroll_rules'], frontendActions: ['hr.payroll.view'], backendActions: ['hr.payroll.view', 'manage_payroll_rules'], status: 'active', risk: 'critical', frontendConsumer: source('js/hr-page.js', 'loadPayrollProfilesCatalog'), apiConsumers: [api('routes/hr.js', '/api/hr/payroll profiles', 'manage_payroll_rules')] }),
    hrTab({ id: 'zrs', label: 'ЗРС', group: 'payroll', additionalActions: ['hr.payroll.view', 'view_payroll'], frontendActions: ['hr.payroll.view'], backendActions: ['hr.payroll.view'], risk: 'critical', frontendConsumer: source('js/hr-page.js', 'loadZrs'), apiConsumers: [api('routes/hr.js', '/api/hr/zrs', 'hr.payroll.view')] }),
    hrTab({ id: 'kpi', label: 'KPI', group: 'payroll', aliases: ['rating', 'ratings'], additionalActions: ['hr.payroll.view', 'view_payroll'], frontendActions: ['hr.payroll.view'], backendActions: ['hr.payroll.view'], status: 'active', risk: 'critical', frontendConsumer: source('js/hr-page.js', 'loadKpi'), apiConsumers: [api('routes/hr.js', '/api/hr/kpi', null, 'Endpoint is covered only by the broad HR router guard.')] }),
    hrTab({ id: 'vacancies', additionalActions: ['hr.staff.view'], frontendActions: ['hr.staff.view'], backendActions: ['hr.staff.view'], label: 'Вакансії', group: 'other', aliases: ['other'], sidebarLinks: ['/hr#other'], frontendConsumer: source('js/hr-page.js', 'loadVacancies'), apiConsumers: [api('routes/hr.js', '/api/hr/vacancies', null)] })
]);

const HR_EXTERNAL_REDIRECTS = Object.freeze([
    Object.freeze({ alias: 'costumes', target: '/warehouse#costumes', source: source('js/hr-page.js', "requested === 'costumes'") }),
    Object.freeze({ alias: 'onboarding', target: '/training#onboarding', source: source('js/hr-page.js', "requested === 'onboarding'") })
]);

const PAGE_PERMISSION_BY_KEY = Object.freeze(Object.fromEntries(PAGE_PERMISSIONS.map(entry => [entry.key, entry])));
const ACTION_PERMISSION_BY_KEY = Object.freeze(Object.fromEntries(ACTION_PERMISSIONS.map(entry => [entry.key, entry])));
const HR_TAB_BY_ID = Object.freeze(Object.fromEntries(HR_TABS.map(entry => [entry.id, entry])));

const PAGE_ALIAS_TO_CANONICAL = Object.freeze(PAGE_PERMISSIONS.reduce((result, entry) => {
    entry.aliases.forEach(alias => { result[alias] = entry.canonicalPath; });
    if (entry.aliasOf) result[entry.key] = entry.canonicalPath;
    return result;
}, {}));

function canonicalizePageKey(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const withoutHash = raw.startsWith('#') ? raw : raw.split('#')[0];
    const withoutQuery = withoutHash.split('?')[0];
    const normalized = withoutQuery.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    return PAGE_ALIAS_TO_CANONICAL[withoutQuery]
        || PAGE_ALIAS_TO_CANONICAL[normalized]
        || normalized;
}

module.exports = {
    ROLE_HIERARCHY,
    PAGE_STATUS,
    ACTION_STATUS,
    PAGE_PERMISSIONS,
    ACTION_PERMISSIONS,
    HR_TABS,
    HR_EXTERNAL_REDIRECTS,
    PAGE_PERMISSION_BY_KEY,
    ACTION_PERMISSION_BY_KEY,
    HR_TAB_BY_ID,
    PAGE_ALIAS_TO_CANONICAL,
    canonicalizePageKey
};
