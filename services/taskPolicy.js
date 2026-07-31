const { getPermissions } = require('../config/roles');

// These sets mirror the legacy requireRole(...) expansion used by task routes.
// They describe existing route access for UI contracts; they do not grant access.
const TASK_ROUTE_CAPABILITY_ROLES = Object.freeze({
    create: Object.freeze([
        'creator', 'director', 'vice_director', 'senior_manager', 'manager',
        'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin',
        'senior_instructor', 'instructor'
    ]),
    delete: Object.freeze([
        'creator', 'director', 'vice_director', 'senior_manager', 'manager',
        'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin'
    ]),
    review: Object.freeze([
        'creator', 'director', 'vice_director', 'senior_manager', 'manager',
        'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin'
    ])
});

const ACTIVE_TASK_STATUS_SQL = "COALESCE(status, 'todo') NOT IN ('done','cancelled','archived')";

function normalizeUserId(user) {
    const parsed = Number(user?.id || user?.userId || 0);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function userNameTokens(user) {
    return [user?.username, user?.name]
        .map(value => String(value || '').trim())
        .filter(Boolean);
}

function userDisplayName(user) {
    return String(user?.name || user?.username || '').trim() || null;
}

function pushParam(params, value) {
    params.push(value);
    return `$${params.length}`;
}

function buildLegacyOwnerMatch(alias, tokenRefs) {
    if (!tokenRefs.length) return 'FALSE';
    const values = tokenRefs.join(',');
    return `(${alias}.owner_user_id IS NULL AND (${alias}.assigned_to IN (${values}) OR ${alias}.owner IN (${values})))`;
}

function buildTaskOwnerMatch(user, params, alias = 't') {
    const userId = normalizeUserId(user);
    const tokenRefs = userNameTokens(user).map(token => pushParam(params, token));
    const legacyMatch = buildLegacyOwnerMatch(alias, tokenRefs);
    const typedMatch = userId ? `${alias}.owner_user_id = ${pushParam(params, userId)}` : 'FALSE';
    return `(${typedMatch} OR ${legacyMatch})`;
}

function buildTaskObserverMatch(user, params, alias = 't') {
    const userId = normalizeUserId(user);
    if (!userId) return 'FALSE';
    return `EXISTS (
        SELECT 1
        FROM task_observers task_observer_scope
        WHERE task_observer_scope.task_id = ${alias}.id
          AND task_observer_scope.user_id = ${pushParam(params, userId)}
    )`;
}

function buildTaskVisibilityScope(user, params, alias = 't') {
    const perms = getPermissions(user?.role);

    const userId = normalizeUserId(user);
    const tokenRefs = userNameTokens(user).map(token => pushParam(params, token));
    const legacyMatch = buildLegacyOwnerMatch(alias, tokenRefs);
    const typedOwnMatch = userId ? `${alias}.owner_user_id = ${pushParam(params, userId)}` : 'FALSE';
    const observerMatch = buildTaskObserverMatch(user, params, alias);
    const ownMatch = `(${typedOwnMatch} OR ${legacyMatch})`;
    const ownOrObserverMatch = `(${typedOwnMatch} OR ${legacyMatch} OR ${observerMatch})`;
    const privacyMatch = `(COALESCE(${alias}.visibility, 'team') = 'team' OR ${ownOrObserverMatch})`;

    if (perms.taskVisibility === 'all') return `AND ${privacyMatch}`;

    if (perms.taskVisibility === 'department') {
        const userIdRef = pushParam(params, userId || 0);
        const departmentUsers = `
            SELECT u.id
            FROM users u
            JOIN employee_profiles ep ON ep.user_id = u.id
            WHERE ep.department IS NOT NULL
              AND ep.department = (
                  SELECT ep2.department
                  FROM employee_profiles ep2
                  WHERE ep2.user_id = ${userIdRef}
                  LIMIT 1
              )
        `;
        const departmentLegacyTokens = `
            SELECT token FROM (
                SELECT u.username AS token
                FROM users u
                JOIN employee_profiles ep ON ep.user_id = u.id
                WHERE ep.department IS NOT NULL
                  AND ep.department = (
                      SELECT ep2.department
                      FROM employee_profiles ep2
                      WHERE ep2.user_id = ${userIdRef}
                      LIMIT 1
                  )
                UNION
                SELECT u.name AS token
                FROM users u
                JOIN employee_profiles ep ON ep.user_id = u.id
                WHERE u.name IS NOT NULL
                  AND u.name <> ''
                  AND ep.department IS NOT NULL
                  AND ep.department = (
                      SELECT ep2.department
                      FROM employee_profiles ep2
                      WHERE ep2.user_id = ${userIdRef}
                      LIMIT 1
                  )
            ) owner_tokens
            WHERE token IS NOT NULL AND token <> ''
        `;
        return `AND ${privacyMatch} AND (
            ${alias}.owner_user_id = ${userIdRef}
            OR ${alias}.owner_user_id IN (${departmentUsers})
            OR (${alias}.owner_user_id IS NULL AND (${alias}.assigned_to IN (${departmentLegacyTokens}) OR ${alias}.owner IN (${departmentLegacyTokens})))
            OR ${legacyMatch}
            OR ${observerMatch}
        )`;
    }

    if (!userId && !tokenRefs.length) return 'AND 1 = 0';
    return `AND ${ownOrObserverMatch}`;
}

function ownsTask(user, task = {}) {
    const userId = normalizeUserId(user);
    if (userId && Number(task.owner_user_id || task.ownerUserId || 0) === userId) return true;
    if (Number(task.owner_user_id || task.ownerUserId || 0) > 0) return false;
    const tokens = new Set(userNameTokens(user));
    return tokens.has(String(task.assigned_to || '').trim()) || tokens.has(String(task.owner || '').trim());
}

function observesTask(user, task = {}) {
    const userId = normalizeUserId(user);
    if (!userId) return false;
    if (task.viewer_is_observer === true || task.viewerIsObserver === true) return true;
    const ids = task.observer_user_ids || task.observerUserIds || task.observers;
    if (!Array.isArray(ids)) return false;
    return ids.some(value => {
        if (value && typeof value === 'object') return Number(value.user_id || value.userId || value.id || 0) === userId;
        return Number(value || 0) === userId;
    });
}

function canViewTask(user, task = {}) {
    const perms = getPermissions(user?.role);
    const privateVisibility = ['private', 'me_only'].includes(String(task.visibility || '').trim());
    if (privateVisibility && !ownsTask(user, task) && !observesTask(user, task)) return false;
    if (perms.taskVisibility === 'all') return true;
    if (perms.taskVisibility === 'department') return true;
    return ownsTask(user, task) || observesTask(user, task);
}

function canMutateTask(user, task = {}) {
    const perms = getPermissions(user?.role);
    const privateVisibility = ['private', 'me_only'].includes(String(task.visibility || '').trim());
    if (privateVisibility && !ownsTask(user, task)) return false;
    if (perms.taskVisibility === 'all') return true;
    if (perms.taskVisibility === 'department') return true;
    return ownsTask(user, task);
}

function canReassignTask(user, task = {}) {
    const perms = getPermissions(user?.role);
    return perms.canAssignAnyone === true || perms.taskVisibility === 'all' || perms.taskVisibility === 'department';
}

const TASK_ROUTE_CAPABILITY_REASON_CODES = Object.freeze({
    create: 'TASK_CREATE_FORBIDDEN',
    delete: 'TASK_DELETE_FORBIDDEN',
    review: 'TASK_REVIEW_FORBIDDEN'
});
function userRoleValues(user = {}) {
    const raw = Array.isArray(user.roles) ? user.roles : [user.role];
    return raw
        .map(value => String(value || '').trim())
        .filter(Boolean);
}

function canUseTaskRouteCapability(user, capability) {
    const allowedRoles = TASK_ROUTE_CAPABILITY_ROLES[capability];
    if (!allowedRoles) return false;
    const roles = userRoleValues(user);
    return roles.includes('creator') || roles.some(role => allowedRoles.includes(role));
}
function taskRouteCapabilityDecision(user, capability) {
    const allowed = canUseTaskRouteCapability(user, capability);
    return {
        allowed,
        reasonCode: allowed ? null : (TASK_ROUTE_CAPABILITY_REASON_CODES[capability] || 'TASK_ACTION_FORBIDDEN')
    };
}
function taskControlMeta(task = {}) {
    const value = task.control_meta || task.controlMeta || {};
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function isExplicitFalse(value) {
    return value === false || value === 'false' || value === '0' || value === 0 || value === 'off' || value === 'no';
}

function canRescheduleTask(user, task = {}) {
    const meta = taskControlMeta(task);
    if (isExplicitFalse(meta.canReschedule) || isExplicitFalse(meta.allowReschedule) || isExplicitFalse(meta.rescheduleAllowed)) return false;
    return canMutateTask(user, task);
}

function canAccessTaskMaterials(user, task = {}) {
    return canViewTask(user, task);
}

function canManageTaskObservers(user, task = {}) {
    return canMutateTask(user, task) || canReassignTask(user, task);
}

function taskOwnerState(task = {}) {
    if (Number(task.owner_user_id || task.ownerUserId || 0) > 0) return 'typed';
    if (task.assigned_to || task.owner) return 'legacy_unknown_owner';
    return 'unassigned';
}

module.exports = {
    ACTIVE_TASK_STATUS_SQL,
    TASK_ROUTE_CAPABILITY_ROLES,
    TASK_ROUTE_CAPABILITY_REASON_CODES,
    buildTaskObserverMatch,
    buildTaskOwnerMatch,
    buildTaskVisibilityScope,
    canAccessTaskMaterials,
    canManageTaskObservers,
    canViewTask,
    canMutateTask,
    canReassignTask,
    canRescheduleTask,
    canUseTaskRouteCapability,
    normalizeUserId,
    observesTask,
    ownsTask,
    taskOwnerState,
    taskRouteCapabilityDecision,
    userDisplayName,
    userRoleValues,
    userNameTokens
};
