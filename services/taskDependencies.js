'use strict';

const OPEN_STATUS_SQL = "COALESCE(blocker.status, 'todo') NOT IN ('done','archived','cancelled')";

function dependencyError(message, statusCode = 400, code = 'TASK_DEPENDENCY_VALIDATION_ERROR') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function taskId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw dependencyError('Invalid task dependency identifier.');
    return id;
}

function emptyDependencyState() {
    return {
        dependencyCount: 0,
        openDependencyCount: 0,
        blockedByTitles: null,
        dependencies: [],
        isBlocked: false
    };
}

function serializeDependency(row = {}) {
    return {
        id: Number(row.depends_on_task_id || row.id),
        title: row.title || '',
        status: row.status || 'todo',
        ownerUserId: row.owner_user_id || row.ownerUserId || null,
        date: row.date || null,
        deadline: row.deadline || null,
        isOpen: row.is_open === true || row.isOpen === true
    };
}

async function listTaskDependencies(queryable, rawTaskId) {
    const id = taskId(rawTaskId);
    const result = await queryable.query(
        `SELECT d.depends_on_task_id, blocker.title, blocker.status, blocker.owner_user_id,
                blocker.date, blocker.deadline,
                (${OPEN_STATUS_SQL}) AS is_open
         FROM task_dependencies d
         JOIN tasks owner_task ON owner_task.id = d.task_id
         JOIN tasks blocker ON blocker.id = d.depends_on_task_id
            AND COALESCE(blocker.business_context, 'event_genix') = COALESCE(owner_task.business_context, 'event_genix')
         WHERE d.task_id = $1
         ORDER BY (${OPEN_STATUS_SQL}) DESC, blocker.id ASC`,
        [id]
    );
    const dependencies = (result.rows || []).map(serializeDependency);
    const open = dependencies.filter(item => item.isOpen);
    return {
        ...emptyDependencyState(),
        dependencyCount: dependencies.length,
        openDependencyCount: open.length,
        blockedByTitles: open.length ? open.map(item => item.title).join(', ') : null,
        dependencies,
        isBlocked: open.length > 0
    };
}

async function loadTaskDependencyStates(queryable, taskIds = []) {
    const sourceIds = Array.isArray(taskIds) ? taskIds : (taskIds && typeof taskIds[Symbol.iterator] === 'function' ? [...taskIds] : []);
    const ids = [...new Set(sourceIds.map(Number).filter(id => Number.isInteger(id) && id > 0))];
    const states = new Map(ids.map(id => [id, emptyDependencyState()]));
    if (!ids.length) return states;
    const result = await queryable.query(
        `SELECT d.task_id, d.depends_on_task_id, blocker.title, blocker.status, blocker.owner_user_id,
                blocker.date, blocker.deadline, (${OPEN_STATUS_SQL}) AS is_open
         FROM task_dependencies d
         JOIN tasks owner_task ON owner_task.id = d.task_id
         JOIN tasks blocker ON blocker.id = d.depends_on_task_id
            AND COALESCE(blocker.business_context, 'event_genix') = COALESCE(owner_task.business_context, 'event_genix')
         WHERE d.task_id = ANY($1::int[])
         ORDER BY d.task_id ASC, (${OPEN_STATUS_SQL}) DESC, blocker.id ASC`,
        [ids]
    );
    for (const row of result.rows || []) {
        const ownerId = Number(row.task_id);
        const state = states.get(ownerId) || emptyDependencyState();
        const dependency = serializeDependency(row);
        state.dependencies.push(dependency);
        state.dependencyCount += 1;
        if (dependency.isOpen) state.openDependencyCount += 1;
        states.set(ownerId, state);
    }
    for (const state of states.values()) {
        const open = state.dependencies.filter(item => item.isOpen);
        state.blockedByTitles = open.length ? open.map(item => item.title).join(', ') : null;
        state.isBlocked = state.openDependencyCount > 0;
    }
    return states;
}

async function assertNoDependencyCycle(queryable, rawTaskId, rawDependsOnTaskId) {
    const id = taskId(rawTaskId);
    const dependsOnId = taskId(rawDependsOnTaskId);
    if (id === dependsOnId) throw dependencyError('A task cannot depend on itself.', 409, 'TASK_DEPENDENCY_SELF_REFERENCE');
    const result = await queryable.query(
        `WITH RECURSIVE dependency_chain(task_id, path) AS (
            SELECT $2::int, ARRAY[$2::int]
            UNION ALL
            SELECT edge.depends_on_task_id, dependency_chain.path || edge.depends_on_task_id
            FROM task_dependencies edge
            JOIN dependency_chain ON edge.task_id = dependency_chain.task_id
            WHERE NOT edge.depends_on_task_id = ANY(dependency_chain.path)
        )
         SELECT 1 FROM dependency_chain WHERE task_id = $1 LIMIT 1`,
        [id, dependsOnId]
    );
    if (result.rows?.length) throw dependencyError('This prerequisite would create a dependency cycle.', 409, 'TASK_DEPENDENCY_CYCLE');
}

async function synchronizeLegacyDependencyIds(queryable, rawTaskId) {
    const id = taskId(rawTaskId);
    await queryable.query(
        `UPDATE tasks
         SET dependency_ids = COALESCE((
             SELECT array_agg(d.depends_on_task_id ORDER BY d.depends_on_task_id)
             FROM task_dependencies d
             WHERE d.task_id = $1
         ), '{}'::int[]),
             updated_at = NOW()
         WHERE id = $1`,
        [id]
    );
}

async function addTaskDependency(queryable, input = {}) {
    const id = taskId(input.taskId);
    const dependsOnId = taskId(input.dependsOnTaskId);
    if (id === dependsOnId) throw dependencyError('A task cannot depend on itself.', 409, 'TASK_DEPENDENCY_SELF_REFERENCE');
    const pair = await queryable.query(
        `SELECT source.id AS task_id, target.id AS depends_on_task_id
         FROM tasks source
         JOIN tasks target ON target.id = $2
           AND COALESCE(target.business_context, 'event_genix') = COALESCE(source.business_context, 'event_genix')
         WHERE source.id = $1
         FOR KEY SHARE`,
        [id, dependsOnId]
    );
    if (!pair.rows?.length) throw dependencyError('Prerequisite task is not available in this business.', 404, 'TASK_DEPENDENCY_NOT_FOUND');
    await assertNoDependencyCycle(queryable, id, dependsOnId);
    await queryable.query(
        `INSERT INTO task_dependencies (task_id, depends_on_task_id)
         VALUES ($1, $2)
         ON CONFLICT (task_id, depends_on_task_id) DO NOTHING`,
        [id, dependsOnId]
    );
    await synchronizeLegacyDependencyIds(queryable, id);
    return listTaskDependencies(queryable, id);
}

async function removeTaskDependency(queryable, input = {}) {
    const id = taskId(input.taskId);
    const dependsOnId = taskId(input.dependsOnTaskId);
    await queryable.query(
        'DELETE FROM task_dependencies WHERE task_id = $1 AND depends_on_task_id = $2',
        [id, dependsOnId]
    );
    await synchronizeLegacyDependencyIds(queryable, id);
    return listTaskDependencies(queryable, id);
}

module.exports = {
    OPEN_STATUS_SQL,
    addTaskDependency,
    assertNoDependencyCycle,
    dependencyError,
    emptyDependencyState,
    listTaskDependencies,
    loadTaskDependencyStates,
    removeTaskDependency,
    synchronizeLegacyDependencyIds,
    taskId
};
