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
    reception: 'operations', wardrobe: 'operations', cleaning: 'operations',
    maintenance: 'operations', waiter: 'service',
};

// v22.0.0: Default dashboard widgets per role
const DEFAULT_WIDGETS = {
    creator:        ['quick_stats', 'tasks', 'team_online', 'bookings_today', 'weather', 'currency', 'announcements'],
    director:       ['quick_stats', 'tasks', 'team_online', 'bookings_today', 'weather', 'currency'],
    vice_director:  ['quick_stats', 'tasks', 'team_online', 'bookings_today', 'weather'],
    senior_manager: ['quick_stats', 'tasks', 'bookings_today', 'weather'],
    manager:        ['tasks', 'bookings_today', 'my_schedule', 'weather'],
    admin:          ['tasks', 'bookings_today', 'my_schedule', 'weather'],
    _default:       ['tasks', 'my_schedule', 'weather', 'announcements'],
};

// Default for unknown roles
const DEFAULT_PERMISSIONS = { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false };

function getPermissions(role) {
    return ROLE_PERMISSIONS[role] || DEFAULT_PERMISSIONS;
}

function getDefaultWidgets(role) {
    return DEFAULT_WIDGETS[role] || DEFAULT_WIDGETS._default;
}

module.exports = { ROLE_PERMISSIONS, DEFAULT_PERMISSIONS, ROLE_DEPARTMENTS, DEFAULT_WIDGETS, getPermissions, getDefaultWidgets };
