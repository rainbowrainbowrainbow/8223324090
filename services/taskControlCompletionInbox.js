'use strict';

const { taskUrl } = require('../js/task-links');

const { TASK_ACTION_TYPES } = require('./taskActionConstants');
const { buildTaskOwnerMatch, normalizeUserId } = require('./taskPolicy');
const { buildTaskControlPredicates } = require('./taskPersonalScope');
const { appendTaskBusinessScopeSql } = require('./taskBusinessScope');

const PAGE_SIZE = 25;

function completionEventKey(value) {
    const match = /^([1-9]\d{0,9}):(-?\d{1,18})$/.exec(String(value || ''));
    if (!match || Number(match[1]) > 2147483647) return null;
    return { taskId: Number(match[1]), micros: match[2] };
}

function eventScope(user, businessScope, params) {
    const userId = normalizeUserId(user);
    const { author, control } = buildTaskControlPredicates(user, params, 't');
    const business = appendTaskBusinessScopeSql(params, businessScope, 't');
    const recipient = `$${params.push(userId)}::int`;
    const snapshotOwner = buildTaskOwnerMatch(user, params, 'completion_owner');
    const completionAction = `$${params.push(TASK_ACTION_TYPES.COMPLETED)}`;
    // The canonical completion writes its task timestamp and action history in one transaction.
    // Use that history for pre-inbox completions whose current task may have been reopened.
    return {
        recipient,
        sql: `WITH authored AS (
            SELECT t.id, t.title, t.status, t.completed_at,
                   COALESCE(t.business_context, 'event_genix') AS business_context,
                   ${control} AS controlled
            FROM tasks t
            WHERE (${author}) IS TRUE AND COALESCE(t.visibility, 'team') = 'team'
              AND COALESCE(t.task_mode, 'work') NOT IN ('personal', 'private') ${business}
        ), recorded_completions AS (
            SELECT a.id AS task_id, h.created_at AT TIME ZONE 'UTC' AS completed_at,
                   (${snapshotOwner}) IS NOT TRUE AS delegated
            FROM authored a
            JOIN task_action_history h ON h.task_id = a.id AND h.action_type = ${completionAction}
            CROSS JOIN LATERAL (
                SELECT CASE WHEN jsonb_typeof(h.new_value_json->'ownerUserId') = 'number'
                            THEN (h.new_value_json->>'ownerUserId')::numeric END AS owner_user_id,
                       h.new_value_json->>'assignedTo' AS assigned_to,
                       h.new_value_json->>'owner' AS owner
            ) completion_owner
            WHERE h.new_value_json->>'status' = 'done' AND h.new_value_json ? 'ownerUserId'
        ), candidate_legacy_completions AS (
            SELECT task_id, completed_at FROM recorded_completions WHERE delegated
            UNION
            SELECT a.id, a.completed_at FROM authored a
            WHERE a.status = 'done' AND a.controlled AND a.completed_at IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM recorded_completions h WHERE h.task_id = a.id AND h.completed_at = a.completed_at
              )
        ), events AS (
            SELECT a.id AS task_id, a.title, a.business_context, i.completed_at, i.read_at
            FROM task_control_completion_inbox i
            JOIN authored a ON a.id = i.task_id AND a.business_context = i.business_context
            WHERE i.recipient_id = ${recipient}
            UNION ALL
            SELECT a.id, a.title, a.business_context, h.completed_at, NULL::timestamptz
            FROM candidate_legacy_completions h
            JOIN authored a ON a.id = h.task_id
            WHERE NOT EXISTS (
                  SELECT 1 FROM task_control_completion_inbox i
                  WHERE i.recipient_id = ${recipient} AND i.task_id = h.task_id AND i.completed_at = h.completed_at
              )
        ), keyed AS (
            SELECT events.*, (EXTRACT(EPOCH FROM completed_at) * 1000000)::bigint AS micros
            FROM events
        )`
    };
}

async function listControlCompletions(db, user, scope, { cursor, summary = false } = {}) {
    const params = [];
    const { sql } = eventScope(user, scope, params);
    const after = completionEventKey(cursor);
    let condition = '';
    if (after && !summary) {
        const micros = params.push(after.micros);
        const taskId = params.push(after.taskId);
        condition = `WHERE (micros, task_id) < ($${micros}::bigint, $${taskId}::int)`;
    }
    // Cast microseconds to text before serializing JSON, which uses JS numbers.
    const page = summary ? "'[]'::json" : `COALESCE((SELECT json_agg(p ORDER BY p.completed_at DESC, p.task_id DESC)
        FROM (SELECT selected.*, completion.actor_name_snapshot AS executor_name
              FROM (SELECT task_id, title, business_context, completed_at, micros::text AS micros, read_at
                    FROM keyed ${condition} ORDER BY completed_at DESC, task_id DESC LIMIT ${PAGE_SIZE + 1}) selected
              LEFT JOIN LATERAL (
                  SELECT h.actor_name_snapshot FROM task_action_history h
                  WHERE h.task_id = selected.task_id AND h.action_type = 'task_completed'
                    AND h.created_at = selected.completed_at AT TIME ZONE 'UTC'
                  ORDER BY h.id DESC LIMIT 1
              ) completion ON TRUE) p), '[]'::json)`;
    const { rows: [result] } = await db.query(`${sql}
        SELECT (SELECT COUNT(*)::int FROM keyed WHERE read_at IS NULL) AS unread, ${page} AS page`, params);
    const alerts = result.page.slice(0, PAGE_SIZE).map(event => ({
        id: `control_completed_${normalizeUserId(user)}_${event.task_id}_${event.micros}`,
        eventKey: `${event.task_id}:${event.micros}`,
        type: 'control_completion',
        level: 'info',
        icon: '✓',
        title: `Завершено: ${event.title || 'Задача без назви'}`,
        message: event.executor_name ? `Виконав(ла): ${event.executor_name}` : 'Виконавця не зафіксовано',
        link: taskUrl(event.task_id, { businessContext: event.business_context }),
        read: Boolean(event.read_at)
    }));
    return { alerts, unread: result.unread, nextCursor: result.page.length > PAGE_SIZE ? alerts.at(-1).eventKey : null };
}

async function markControlCompletionsRead(db, user, scope, { eventKey, all = false } = {}) {
    const params = [];
    const { recipient, sql } = eventScope(user, scope, params);
    let condition = '';
    if (!all) {
        const key = completionEventKey(eventKey);
        if (!key) return false;
        const taskId = params.push(key.taskId);
        const micros = params.push(key.micros);
        condition = `AND task_id = $${taskId}::int AND micros = $${micros}::bigint`;
    }
    await db.query(`${sql}
        INSERT INTO task_control_completion_inbox (recipient_id, task_id, business_context, completed_at, read_at)
        SELECT ${recipient}, task_id, business_context, completed_at, NOW()
        FROM keyed WHERE read_at IS NULL ${condition}
        ON CONFLICT (recipient_id, task_id, completed_at) DO UPDATE SET read_at = EXCLUDED.read_at
        WHERE task_control_completion_inbox.read_at IS NULL
          AND task_control_completion_inbox.business_context = EXCLUDED.business_context`, params);
    return true;
}

module.exports = { completionEventKey, listControlCompletions, markControlCompletionsRead };
