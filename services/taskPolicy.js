const { getPermissions } = require('../config/roles');

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

function buildTaskVisibilityScope(user, params, alias = 't') {
    const perms = getPermissions(user?.role);

    const userId = normalizeUserId(user);
    const tokenRefs = userNameTokens(user).map(token => pushParam(params, token));
    const legacyMatch = buildLegacyOwnerMatch(alias, tokenRefs);
    const typedOwnMatch = userId ? `${alias}.owner_user_id = ${pushParam(params, userId)}` : 'FALSE';
    const ownMatch = `(${typedOwnMatch} OR ${legacyMatch})`;
    const privacyMatch = `(COALESCE(${alias}.visibility, 'team') = 'team' OR ${ownMatch})`;

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
        )`;
    }

    if (!userId && !tokenRefs.length) return 'AND 1 = 0';
    return `AND ${ownMatch}`;
}

function ownsTask(user, task = {}) {
    const userId = normalizeUserId(user);
    if (userId && Number(task.owner_user_id || task.ownerUserId || 0) === userId) return true;
    if (Number(task.owner_user_id || task.ownerUserId || 0) > 0) return false;
    const tokens = new Set(userNameTokens(user));
    return tokens.has(String(task.assigned_to || '').trim()) || tokens.has(String(task.owner || '').trim());
}

function canViewTask(user, task = {}) {
    const perms = getPermissions(user?.role);
    const privateVisibility = ['private', 'me_only'].includes(String(task.visibility || '').trim());
    if (privateVisibility && !ownsTask(user, task)) return false;
    if (perms.taskVisibility === 'all') return true;
    if (perms.taskVisibility === 'department') return true;
    return ownsTask(user, task);
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

function canRescheduleTask(user, task = {}) {
    return canMutateTask(user, task);
}

function taskOwnerState(task = {}) {
    if (Number(task.owner_user_id || task.ownerUserId || 0) > 0) return 'typed';
    if (task.assigned_to || task.owner) return 'legacy_unknown_owner';
    return 'unassigned';
}

module.exports = {
    ACTIVE_TASK_STATUS_SQL,
    buildTaskOwnerMatch,
    buildTaskVisibilityScope,
    canViewTask,
    canMutateTask,
    canReassignTask,
    canRescheduleTask,
    normalizeUserId,
    ownsTask,
    taskOwnerState,
    userDisplayName,
    userNameTokens
};
