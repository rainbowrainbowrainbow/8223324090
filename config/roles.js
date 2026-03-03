/**
 * config/roles.js — Role permissions config (v20.9.16)
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
    creator:            { taskVisibility: 'all', canCreateTasks: true, canDeleteTasks: true, canAssignAnyone: true },
    director:           { taskVisibility: 'all', canCreateTasks: true, canDeleteTasks: true, canAssignAnyone: true },
    vice_director:      { taskVisibility: 'all', canCreateTasks: true, canDeleteTasks: true, canAssignAnyone: true },
    senior_manager:     { taskVisibility: 'all', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: true },
    manager:            { taskVisibility: 'department', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: false },
    admin:              { taskVisibility: 'own', canCreateTasks: true, canDeleteTasks: false, canAssignAnyone: false },
    senior_instructor:  { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    instructor:         { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    animator:           { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
    waiter:             { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false },
};

// Default for unknown roles
const DEFAULT_PERMISSIONS = { taskVisibility: 'own', canCreateTasks: false, canDeleteTasks: false, canAssignAnyone: false };

function getPermissions(role) {
    return ROLE_PERMISSIONS[role] || DEFAULT_PERMISSIONS;
}

module.exports = { ROLE_PERMISSIONS, DEFAULT_PERMISSIONS, getPermissions };
