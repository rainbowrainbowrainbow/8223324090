'use strict';

const { buildTaskOwnerMatch, buildTaskObserverMatch, buildTaskVisibilityScope,
    normalizeUserId, ownsTask, observesTask } = require('./taskPolicy');

// Personal membership narrows existing visibility. Authorship never bypasses
// private-task, department or business restrictions, and never grants write access.
function buildTaskPersonalQuery(user, params, alias = 't') {
    if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid task SQL alias');
    const owner = buildTaskOwnerMatch(user, params, alias);
    const id = normalizeUserId(user);
    let author = 'FALSE';
    if (id) {
        params.push(id);
        const idRef = `$${params.length}`;
        params.push(String(user.username || ''));
        const nameRef = `$${params.length}`;
        author = `(${alias}.created_by_user_id = ${idRef} OR (${alias}.created_by_user_id IS NULL AND ${nameRef} <> '' AND ${alias}.created_by = ${nameRef}))`;
    }
    const participant = buildTaskObserverMatch(user, params, alias);
    const visibility = buildTaskVisibilityScope(user, params, alias);
    return {
        match: `((${owner} OR ${author} OR ${participant}) ${visibility})`,
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

module.exports = { buildTaskPersonalQuery, taskViewerRoles };
