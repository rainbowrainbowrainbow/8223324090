'use strict';

const { canReassignTask, normalizeUserId } = require('./taskPolicy');
const { getAssignableTaskOwner, getAssignableTaskOwners } = require('./taskExecution');
const { TASK_ACTION_TYPES, logTaskActionEvent } = require('./taskActionHistory');

function normalizeCreationCoAssignees(value = [], ownerId) {
    if (!Array.isArray(value) || value.length > 100
        || value.some(id => !/^[1-9]\d*$/.test(String(id)) || Number(id) > 2147483647)) {
        throw Object.assign(new Error('Потрібен список коректних ідентифікаторів співвиконавців'),
            { statusCode: 400, code: 'TASK_CO_ASSIGNEES_INVALID' });
    }
    return [...new Set(value.map(Number))].filter(id => id !== Number(ownerId)).sort((a, b) => a - b);
}

async function validateCreationCoAssignees(client, ids, actor, businessContext, resolveOwner = getAssignableTaskOwner) {
    if (!ids.length) return;
    if (!canReassignTask(actor)) {
        throw Object.assign(new Error('Недостатньо прав для призначення співвиконавців'),
            { statusCode: 403, code: 'TASK_REASSIGN_FORBIDDEN' });
    }
    const options = { pool: client, actor, businessContext };
    if (resolveOwner !== getAssignableTaskOwner) {
        for (const id of ids) await resolveOwner(id, options);
        return;
    }
    const owners = await getAssignableTaskOwners(ids, options);
    if (owners.length !== ids.length) {
        throw Object.assign(new Error('Task owner is not active or assignable'),
            { statusCode: 400, code: 'TASK_OWNER_NOT_ASSIGNABLE' });
    }
}

async function saveCreationCoAssignees(client, task, ids, actor, sourceSurface) {
    if (!ids.length) return;
    await client.query(`INSERT INTO task_co_assignees (task_id, user_id, added_by)
        SELECT $1, user_id, $3 FROM unnest($2::int[]) AS assignee(user_id)`, [task.id, ids, normalizeUserId(actor)]);
    await logTaskActionEvent({ taskId: task.id, actionType: TASK_ACTION_TYPES.CO_ASSIGNEES_UPDATED,
        actor, sourceSurface, oldValue: { userIds: [] }, newValue: { userIds: ids } }, { pool: client });
    task.co_assignee_user_ids = ids;
}

module.exports = { normalizeCreationCoAssignees, validateCreationCoAssignees, saveCreationCoAssignees };
