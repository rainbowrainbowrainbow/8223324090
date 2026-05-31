'use strict';

const { createLogger } = require('../utils/logger');

const log = createLogger('TaskNotifications');

function normalizeNotificationUserId(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function taskOwnerUserId(task = {}) {
    return normalizeNotificationUserId(
        task.owner_user_id
        || task.ownerUserId
        || task.owner_user
        || task.ownerUser
    );
}

function actorUserId(actor = {}) {
    return normalizeNotificationUserId(
        actor.id
        || actor.userId
        || actor.user_id
        || actor.actorUserId
    );
}

function taskTitle(task = {}) {
    return String(task.title || task.name || `Задача #${task.id || ''}`).trim();
}

function actorPayload(actor = {}) {
    return {
        id: actorUserId(actor),
        username: actor.username || actor.name || actor.displayName || actor.display_name || null
    };
}

function taskPayload(task = {}) {
    const ownerUserId = taskOwnerUserId(task);
    return {
        id: task.id || task.task_id || task.taskId || null,
        title: taskTitle(task),
        priority: task.priority || 'normal',
        ownerUserId,
        assignedTo: task.assigned_to || task.assignedTo || null,
        workflowState: task.workflow_state || task.workflowState || null,
        sourceType: task.source_type || task.sourceType || null,
        sourceId: task.source_id || task.sourceId || null,
        businessContext: task.business_context || task.businessContext || null
    };
}

function taskNotificationId(task = {}, ownerUserId, assignmentEvent) {
    const taskId = task.id || task.task_id || task.taskId || 'new';
    return `task:${assignmentEvent || 'assigned'}:${taskId}:${ownerUserId || 'unknown'}`;
}

function emitTaskAssignedToOwner(task = {}, actor = {}, options = {}) {
    const ownerUserId = taskOwnerUserId(task);
    const actorId = actorUserId(actor);
    const skipActor = options.skipActor !== false;
    const assignmentEvent = options.assignmentEvent || options.reason || 'assigned';

    if (!ownerUserId) return { sent: false, reason: 'no_owner_user_id' };
    if (skipActor && actorId && String(ownerUserId) === String(actorId)) {
        return { sent: false, reason: 'actor_is_owner' };
    }

    try {
        const { sendToUser } = require('./websocket');
        const notificationId = options.notificationId || taskNotificationId(task, ownerUserId, assignmentEvent);
        sendToUser(String(ownerUserId), 'task:assigned', {
            notificationId,
            assignmentEvent,
            task: taskPayload(task),
            actor: actorPayload(actor),
            meta: {
                canonicalField: 'tasks.owner_user_id',
                source: options.source || 'tasks',
                sound: 'task-new'
            }
        });
        return { sent: true, ownerUserId, notificationId };
    } catch (err) {
        log.warn(`Task assignment websocket notification failed: ${err.message}`);
        return { sent: false, reason: 'error', error: err.message };
    }
}

module.exports = {
    emitTaskAssignedToOwner,
    taskOwnerUserId,
    taskNotificationId
};
