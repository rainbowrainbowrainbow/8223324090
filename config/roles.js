/**
 * config/roles.js — Role permissions config (v22.0.0)
 *
 * EASY TO EXTEND: just add new roles here.
 * Uses the same role names as middleware/auth.js ROLE_HIERARCHY.
 *
 * taskVisibility:
 *   'all'        — sees all tasks
 *   'department'  — sees tasks of own department (via employee_profiles)
 *   'own'         — sees only own tasks (assigned_to = me)
 */
const ROLE_PERMISSIONS = {
    // Executive
    creator:            { taskVisibility: 'all', canCreateTasks: true, canDeleteTasks: true, canAssignAnyone: true },
    director:           { taskVisibility: 'all', canCreateTasks: true, canDeleteTasks: true, canAssignAnyone: true },
    vice_director:      { taskVisibility: 'all', canCreateTasks: true, canDeleteTasks: true, canAssignAnyone: true },
    // Management
    senior_manager:     { taskVisibility: 'all', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: true },
    manager:            { taskVisibility: 'department', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: false },
    // Specialist roles
    accountant:         { taskVisibility: 'department', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: false },
    art_director:       { taskVisibility: 'department', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: false },
    marketer:           { taskVisibility: 'department', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: false },
    it_specialist:      { taskVisibility: 'all', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: false },
    hr:                 { taskVisibility: 'department', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: false },
    // Operations
    admin:              { taskVisibility: 'own', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: false },
    security:           { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    // Programs
    senior_instructor:  { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    instructor:         { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    // Kitchen
    head_chef:          { taskVisibility: 'department', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: false },
    cook:               { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    head_pastry:        { taskVisibility: 'department', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: false },
    pastry_chef:        { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    // Field
    animator:           { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    reception:          { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    barista:            { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    wardrobe:           { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    cleaning:           { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    maintenance:        { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    dishwasher:         { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    waiter:             { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
};

// v22.0.0: Role departments mapping
const ROLE_DEPARTMENTS = {
    creator: 'executive', director: 'executive', vice_director: 'executive',
    senior_manager: 'management', manager: 'management',
    accountant: 'finance', art_director: 'creative', marketer: 'marketing',
    it_specialist: 'it', hr: 'hr',
    admin: 'operations',
    senior_instructor: 'programs', instructor: 'programs', animator: 'programs',
    head_chef: 'kitchen', cook: 'kitchen', head_pastry: 'kitchen',
    pastry_chef: 'kitchen', barista: 'kitchen', dishwasher: 'kitchen',
    reception: 'operations', security: 'operations', wardrobe: 'operations', cleaning: 'operations',
    maintenance: 'operations', waiter: 'service',
};

// v24.3.0: Default dashboard widgets per role (all 24 roles)
const DEFAULT_WIDGETS = {
    // Executive — full overview
    creator:        ['quick_stats', 'director_pnl', 'staff_today', 'week_bookings', 'team_tasks', 'exceptions', 'team_online', 'bookings_today', 'leads_new', 'finance_today', 'catalogs', 'weather', 'currency', 'announcements'],
    director:       ['director_pnl', 'quick_stats', 'staff_today', 'week_bookings', 'team_tasks', 'exceptions', 'team_online', 'bookings_today', 'leads_new', 'finance_today', 'weather', 'currency', 'announcements'],
    vice_director:  ['operations', 'quick_stats', 'staff_today', 'week_bookings', 'team_tasks', 'exceptions', 'team_online', 'bookings_today', 'finance_today', 'weather', 'announcements'],
    // Management
    senior_manager: ['quick_stats', 'staff_today', 'week_bookings', 'team_tasks', 'exceptions', 'bookings_today', 'team_online', 'leads_new', 'weather', 'announcements'],
    manager:        ['staff_today', 'week_bookings', 'exceptions', 'tasks', 'bookings_today', 'my_schedule', 'leads_new', 'weather', 'announcements'],
    // Specialists
    accountant:     ['finance_today', 'tasks', 'quick_stats', 'currency', 'weather'],
    art_director:   ['content_pipeline', 'tasks', 'my_schedule', 'bookings_today', 'weather', 'announcements'],
    marketer:       ['leads_new', 'tasks', 'quick_stats', 'weather', 'announcements'],
    it_specialist:  ['tasks', 'alerts', 'team_online', 'weather'],
    hr:             ['hr_overview', 'staff_today', 'tasks', 'team_online', 'my_schedule', 'announcements', 'weather'],
    // Operations
    admin:          ['exceptions', 'tasks', 'bookings_today', 'my_schedule', 'weather', 'announcements'],
    security:       ['my_schedule', 'tasks', 'alerts', 'weather'],
    // Programs
    senior_instructor: ['my_schedule', 'tasks', 'bookings_today', 'weather', 'announcements'],
    instructor:     ['my_schedule', 'tasks', 'bookings_today', 'weather'],
    // Kitchen
    head_chef:      ['tasks', 'my_schedule', 'bookings_today', 'weather'],
    cook:           ['my_schedule', 'tasks', 'weather'],
    head_pastry:    ['tasks', 'my_schedule', 'bookings_today', 'weather'],
    pastry_chef:    ['my_schedule', 'tasks', 'weather'],
    // Field
    animator:       ['my_schedule', 'tasks', 'bookings_today', 'weather'],
    reception:      ['exceptions', 'bookings_today', 'tasks', 'my_schedule', 'weather'],
    barista:        ['my_schedule', 'tasks', 'weather'],
    wardrobe:       ['my_schedule', 'tasks', 'weather'],
    cleaning:       ['my_schedule', 'tasks', 'weather'],
    maintenance:    ['my_schedule', 'tasks', 'alerts', 'weather'],
    dishwasher:     ['my_schedule', 'tasks', 'weather'],
    waiter:         ['my_schedule', 'tasks', 'weather'],
    // Fallback
    _default:       ['tasks', 'my_schedule', 'weather', 'announcements'],
};

// Frontend mirrors these thresholds in js/dashboard-page.js.
// Server routes use them as the authoritative guard for direct widget API calls.
const DASHBOARD_WIDGET_MIN_ROLES = {
    tasks: null,
    bookings_today: 'admin',
    my_schedule: null,
    team_online: 'manager',
    quick_stats: 'admin',
    alerts: null,
    leads_new: 'manager',
    finance_today: 'senior_manager',
    announcements: null,
    weather: null,
    currency: 'manager',
    reports_today: 'senior_manager',
    exceptions: 'admin',
    catalogs: 'admin',
    account_stats: 'manager',
    staff_today: 'manager',
    week_bookings: 'admin',
    team_tasks: 'manager',
    hr_overview: 'hr',
    director_pnl: 'director',
    content_pipeline: 'art_director',
    task_health: 'manager',
    operations: 'vice_director',
};

// Default for unknown roles
const DEFAULT_PERMISSIONS = { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false };

function getPermissions(role) {
    return ROLE_PERMISSIONS[role] || DEFAULT_PERMISSIONS;
}

function getDefaultWidgets(role) {
    return DEFAULT_WIDGETS[role] || DEFAULT_WIDGETS._default;
}

function canAccessDashboardWidget(role, widgetType, roleLevel = {}) {
    if (!Object.prototype.hasOwnProperty.call(DASHBOARD_WIDGET_MIN_ROLES, widgetType)) {
        return null;
    }

    if (getDefaultWidgets(role).includes(widgetType)) {
        return true;
    }

    const minRole = DASHBOARD_WIDGET_MIN_ROLES[widgetType];
    if (!minRole) return true;

    const userLevel = roleLevel[role];
    const minLevel = roleLevel[minRole];
    return Number.isInteger(userLevel) && Number.isInteger(minLevel) && userLevel >= minLevel;
}

module.exports = {
    ROLE_PERMISSIONS,
    DEFAULT_PERMISSIONS,
    ROLE_DEPARTMENTS,
    DEFAULT_WIDGETS,
    DASHBOARD_WIDGET_MIN_ROLES,
    getPermissions,
    getDefaultWidgets,
    canAccessDashboardWidget
};
