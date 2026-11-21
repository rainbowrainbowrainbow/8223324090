const { getPermissions } = require('../config/roles');
const { resolveCapability, ACTION_PERMISSIONS } = require('./accountAccessPolicy');

// Compatibility metadata comes from the same registry as runtime decisions.
const TASK_ROUTE_CAPABILITY_ROLES = Object.freeze({
    create: ACTION_PERMISSIONS['tasks.create'],
    delete: ACTION_PERMISSIONS['tasks.delete'],
    review: ACTION_PERMISSIONS['tasks.review']
});
const TASK_ROUTE_CAPABILITY_ACTIONS = Object.freeze({
    create: 'tasks.create',
    delete: 'tasks.delete',
    review: 'tasks.review'
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

function buildTaskCoAssigneeMatch(user, params, alias = 't') {
    const userId = normalizeUserId(user);
    if (!userId) return 'FALSE';
    return `EXISTS (SELECT 1 FROM task_co_assignees task_co_scope
        WHERE task_co_scope.task_id = ${alias}.id
          AND task_co_scope.user_id = ${pushParam(params, userId)})`;
}

function buildTaskTeamMemberQuery(user, params, actorRef = null) {
    const userRef = actorRef || pushParam(params, normalizeUserId(user) || 0);
    const membership = user?.activeBusinessMembership;
    const businessRef = pushParam(params, Number(membership?.businessId) || 0);
    const organizationRef = pushParam(params, Number(membership?.organizationId) || 0);
    return `SELECT target.user_id
        FROM employee_profiles target
        JOIN staff target_staff ON target_staff.id = target.staff_id AND target_staff.is_active IS TRUE
        JOIN employee_profiles actor_profile ON actor_profile.user_id = ${userRef} AND actor_profile.is_active IS TRUE
        JOIN staff actor_staff ON actor_staff.id = actor_profile.staff_id AND actor_staff.is_active IS TRUE
        JOIN business_memberships target_member ON target_member.user_id = target.user_id
            AND target_member.business_id = ${businessRef} AND target_member.organization_id = ${organizationRef}
            AND target_member.is_active IS TRUE
        JOIN organization_memberships target_org ON target_org.user_id = target.user_id
            AND target_org.organization_id = ${organizationRef} AND target_org.is_active IS TRUE
        WHERE target.is_active IS TRUE AND actor_staff.company_structure_node_id IS NOT NULL
          AND (SELECT COUNT(*) FROM employee_profiles actor_link
               JOIN staff actor_link_staff ON actor_link_staff.id = actor_link.staff_id AND actor_link_staff.is_active IS TRUE
               WHERE actor_link.user_id = ${userRef} AND actor_link.is_active IS TRUE) = 1
          AND target_staff.company_structure_node_id = actor_staff.company_structure_node_id`;
}

function buildTaskVisibilityScope(user, params, alias = 't') {
    const perms = getPermissions(user);

    const userId = normalizeUserId(user);
    const tokenRefs = userNameTokens(user).map(token => pushParam(params, token));
    const legacyMatch = buildLegacyOwnerMatch(alias, tokenRefs);
    const typedOwnMatch = userId ? `${alias}.owner_user_id = ${pushParam(params, userId)}` : 'FALSE';
    const observerMatch = buildTaskObserverMatch(user, params, alias);
    const coAssigneeMatch = buildTaskCoAssigneeMatch(user, params, alias);
    const ownMatch = `(${typedOwnMatch} OR ${legacyMatch})`;
    const ownOrObserverMatch = `(${typedOwnMatch} OR ${legacyMatch} OR ${observerMatch} OR ${coAssigneeMatch})`;
    const privacyMatch = `(COALESCE(${alias}.visibility, 'team') = 'team' OR ${ownOrObserverMatch})`;

    if (perms.taskVisibility === 'all') return `AND ${privacyMatch}`;

    if (perms.taskVisibility === 'department') {
        const userIdRef = pushParam(params, userId || 0);
        // Department text is not authority. A team is a shared canonical staff
        // structure node, backed by active profiles, staff and memberships.
        const departmentUsers = buildTaskTeamMemberQuery(user, params, userIdRef);
        return `AND ${privacyMatch} AND (
            ${alias}.owner_user_id = ${userIdRef}
            OR ${alias}.owner_user_id IN (${departmentUsers})
            OR ${legacyMatch}
            OR ${observerMatch}
            OR ${coAssigneeMatch}
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

function isTaskCoAssignee(user, task = {}) {
    const id = normalizeUserId(user);
    if (!id) return false;
    if (task.viewer_is_co_assignee === true || task.viewerIsCoAssignee === true) return true;
    const ids = task.co_assignee_user_ids || task.coAssigneeUserIds || [];
    return Array.isArray(ids) && ids.some(value => Number(value) === id);
}

function canChangeTaskStatus(user, task = {}) {
    return canMutateTask(user, task) || isTaskCoAssignee(user, task);
}

function canViewTask(user, task = {}) {
    const perms = getPermissions(user);
    const privateVisibility = ['private', 'me_only'].includes(String(task.visibility || '').trim());
    if (privateVisibility && !ownsTask(user, task) && !observesTask(user, task) && !isTaskCoAssignee(user, task)) return false;
    if (perms.taskVisibility === 'all') return true;
    if (perms.taskVisibility === 'department') return true;
    return ownsTask(user, task) || observesTask(user, task) || isTaskCoAssignee(user, task);
}

function canMutateTask(user, task = {}) {
    const perms = getPermissions(user);
    const privateVisibility = ['private', 'me_only'].includes(String(task.visibility || '').trim());
    if (privateVisibility && !ownsTask(user, task)) return false;
    if (perms.taskVisibility === 'all') return true;
    if (perms.taskVisibility === 'department') return true;
    return ownsTask(user, task);
}

function canReassignTask(user, task = {}) {
    const perms = getPermissions(user);
    return perms.canAssignAnyone === true || perms.taskVisibility === 'all' || perms.taskVisibility === 'department';
}

function isTaskAuthor(user, task = {}) {
    const id = normalizeUserId(user);
    if (!id || user?.is_active === false || user?.isActive === false || user?.role === 'guest') return false;
    const authorId = task.created_by_user_id ?? task.createdByUserId;
    return authorId == null ? Boolean(user.username && task.created_by === user.username) : Number(authorId) === id;
}

function canCancelTask(user, task = {}) {
    return isTaskAuthor(user, task) || (canMutateTask(user, task) && canReassignTask(user, task));
}

function taskVisibilityValue(task = {}) {
    return String(task.visibility || task.taskVisibility || '').trim().toLowerCase();
}

function isPrivateTaskVisibility(task = {}) {
    return ['private', 'me_only'].includes(taskVisibilityValue(task));
}

function privateTaskHandoffNeedsConfirmation(task = {}, actor = {}, nextOwnerUserId, actorRetainsObserverAccess = false) {
    const actorId = normalizeUserId(actor);
    const nextOwnerId = Number(nextOwnerUserId || 0);
    if (!isPrivateTaskVisibility(task) || !actorId || !Number.isInteger(nextOwnerId) || nextOwnerId <= 0) return false;
    if (nextOwnerId === actorId || actorRetainsObserverAccess === true) return false;
    return ownsTask(actor, task);
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
    return taskRouteCapabilityDecision(user, capability).allowed;
}
function taskRouteCapabilityDecision(user, capability) {
    const action = TASK_ROUTE_CAPABILITY_ACTIONS[capability];
    if (!action) {
        return {
            allowed: false,
            source: 'default_deny',
            sourceRole: null,
            reason: 'unknown_capability',
            capability: `action:${String(capability || '')}`,
            type: 'action',
            key: String(capability || ''),
            requestedKey: String(capability || ''),
            reasonCode: 'TASK_ACTION_FORBIDDEN'
        };
    }
    const decision = resolveCapability(user, action, { type: 'action' });
    return {
        ...decision,
        taskCapability: capability,
        action,
        reasonCode: decision.allowed ? null : (TASK_ROUTE_CAPABILITY_REASON_CODES[capability] || 'TASK_ACTION_FORBIDDEN')
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
    buildTaskCoAssigneeMatch,
    buildTaskOwnerMatch,
    buildTaskTeamMemberQuery,
    buildTaskVisibilityScope,
    canAccessTaskMaterials,
    canManageTaskObservers,
    canViewTask,
    canMutateTask,
    canChangeTaskStatus,
    canCancelTask,
    canReassignTask,
    canRescheduleTask,
    canUseTaskRouteCapability,
    isPrivateTaskVisibility,
    normalizeUserId,
    observesTask,
    isTaskCoAssignee,
    ownsTask,
    taskOwnerState,
    privateTaskHandoffNeedsConfirmation,
    taskRouteCapabilityDecision,
    userDisplayName,
    userRoleValues,
    userNameTokens
};
