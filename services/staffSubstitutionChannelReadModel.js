'use strict';

const { canAccessBusinessContext } = require('./businessContext');
const { buildTaskVisibilityScope } = require('./taskPolicy');
const { taskUrl } = require('../js/task-links');

async function listChannelSubstitutions(db, actor, channelId) {
    const business = 'event_genix';
    if (!canAccessBusinessContext(actor, business)) return [];

    const params = [channelId, actor.id || actor.userId, business];
    const taskVisibility = buildTaskVisibilityScope(actor, params);
    const { rows } = await db.query(`
        WITH scope AS (
            SELECT ch.id, b.id AS booking_id
            FROM chat_channels ch
            JOIN chat_channel_members m ON m.channel_id=ch.id AND m.user_id=$2
            JOIN bookings b ON b.id=ch.linked_booking_id AND COALESCE(b.business_context,'event_genix')=$3
            WHERE ch.id=$1 AND ch.is_archived IS NOT TRUE AND ch.is_dm IS NOT TRUE
        ), items AS (
            SELECT 'chat_task' AS kind, ct.id AS item_id, ct.title, NULL::integer AS task_id, ss.id, ss.state
            FROM scope ch
            JOIN chat_tasks ct ON ct.channel_id=ch.id
            JOIN staff_substitutions ss ON ss.source_type='chat_task' AND ss.source_id=ct.id::text
                AND ss.source_snapshot->'record'->>'booking_id'=ch.booking_id AND ss.business_context=$3
                AND ss.source_snapshot->'record'->>'channel_id'=ch.id::text
            WHERE ct.message_id IS NULL AND (ct.assigned_to=$2 OR ct.assigned_by=$2)
            UNION ALL
            SELECT 'meeting_action', a.id, a.description, NULL, ss.id, ss.state
            FROM scope ch
            JOIN meeting_notes n ON n.channel_id=ch.id AND n.created_by=$2
            JOIN meeting_action_items a ON a.meeting_id=n.id
            JOIN staff_substitutions ss ON ss.source_type='meeting_action' AND ss.source_id=a.id::text
                AND ss.source_snapshot->'record'->>'booking_id'=ch.booking_id AND ss.business_context=$3
                AND ss.source_snapshot->'record'->>'channel_id'=ch.id::text
                AND ss.source_snapshot->'record'->>'meeting_id'=n.id::text
            WHERE a.task_id IS NULL AND NOT EXISTS (
                SELECT 1 FROM tasks t WHERE t.source_type='meeting_action' AND t.source_id=a.id::text
            )
            UNION ALL
            SELECT 'meeting_action', a.id, t.title, t.id, ss.id, ss.state
            FROM scope ch
            JOIN meeting_notes n ON n.channel_id=ch.id AND n.created_by=$2
            JOIN meeting_action_items a ON a.meeting_id=n.id
            JOIN tasks t ON t.id=a.task_id AND t.source_type='meeting_action' AND t.source_id=a.id::text
                AND COALESCE(t.business_context,'event_genix')=$3
            JOIN staff_substitutions ss ON ss.source_type='task' AND ss.source_id=t.id::text AND ss.business_context=$3
            WHERE TRUE ${taskVisibility}
        )
        SELECT kind, item_id AS "itemId", title, task_id AS "taskId", id::text, state
        FROM items WHERE state IN ('active','completed')
        ORDER BY items.id DESC LIMIT 50`, params);
    return rows.map(row => row.taskId ? { ...row, taskHref: taskUrl(row.taskId, { businessContext: business }) } : row);
}

module.exports = { listChannelSubstitutions };
