'use strict';

const { buildTaskOwnerMatch, buildTaskObserverMatch, buildTaskVisibilityScope,
    normalizeUserId, ownsTask, observesTask } = require('./taskPolicy');

function buildTaskAuthorMatch(user, params, alias = 't') {
    if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid task SQL alias');
    const id = normalizeUserId(user);
    if (!id || user?.is_active === false || user?.isActive === false || user?.role === 'guest') return 'FALSE';
    const idRef = params.push(id);
    const nameRef = params.push(String(user.username || ''));
    return `(${alias}.created_by_user_id = $${idRef}
        OR (${alias}.created_by_user_id IS NULL AND $${nameRef} <> '' AND ${alias}.created_by = $${nameRef}))`;
}

function buildAuthoredTeamTaskMatch(user, params, alias = 't') {
    return authoredTeamTaskSql(buildTaskAuthorMatch(user, params, alias), alias);
}

function buildTaskControlPredicates(user, params, alias = 't') {
    const author = buildTaskAuthorMatch(user, params, alias);
    const owner = buildTaskOwnerMatch(user, params, alias);
    return { author, owner, control: `((${author}) IS TRUE AND (${owner}) IS NOT TRUE)` };
}

function authoredTeamTaskSql(author, alias) {
    return `(COALESCE(${alias}.visibility, 'team') = 'team'
        AND COALESCE(${alias}.task_mode, 'work') NOT IN ('personal', 'private') AND (${author}) IS TRUE)`;
}

// Callers must apply the business scope separately. Keep the existing
// visibility predicate for workflows that mutate the selected task.
function buildTaskPersonalQuery(user, params, alias = 't', { authorRead = true } = {}) {
    const { author, owner, control } = buildTaskControlPredicates(user, params, alias);
    const participant = buildTaskObserverMatch(user, params, alias);
    const visibility = buildTaskVisibilityScope(user, params, alias);
    return {
        match: `(((${owner} OR ${author} OR ${participant}) ${visibility}) OR ${authorRead ? authoredTeamTaskSql(author, alias) : 'FALSE'})`,
        control,
        roles: `array_remove(ARRAY[CASE WHEN ${owner} THEN 'executor' END, CASE WHEN ${author} THEN 'author' END, CASE WHEN ${participant} THEN 'participant' END], NULL)`
    };
}

function taskViewerRoles(user, row) {
    if (!user) return [];
    if (Array.isArray(row.viewer_roles)) return ['executor', 'author', 'participant'].filter(role => row.viewer_roles.includes(role));
    const id = normalizeUserId(user);
    const author = id && (Number(row.created_by_user_id) === id
        || (!row.created_by_user_id && user.username && row.created_by === user.username));
    return [ownsTask(user, row) && 'executor', author && 'author', observesTask(user, row) && 'participant'].filter(Boolean);
}

module.exports = { buildAuthoredTeamTaskMatch, buildTaskControlPredicates, buildTaskPersonalQuery, taskViewerRoles };
