'use strict';

const { normalizeUserId } = require('./taskPolicy');
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
    // Read the last completion of pre-inbox tasks without a production backfill.
    return {
        recipient,
        sql: `WITH authored AS (
            SELECT t.id, t.title, t.status, t.completed_at,
                   COALESCE(t.business_context, 'event_genix') AS business_context,
                   ${control} AS controlled
            FROM tasks t
            WHERE (${author}) IS TRUE AND COALESCE(t.visibility, 'team') = 'team'
              AND COALESCE(t.task_mode, 'work') NOT IN ('personal', 'private') ${business}
        ), events AS (
            SELECT a.id AS task_id, a.title, a.business_context, i.completed_at, i.read_at
            FROM task_control_completion_inbox i
            JOIN authored a ON a.id = i.task_id AND a.business_context = i.business_context
            WHERE i.recipient_id = ${recipient}
            UNION ALL
            SELECT a.id, a.title, a.business_context, a.completed_at, NULL::timestamptz
            FROM authored a
            WHERE a.status = 'done' AND a.controlled AND a.completed_at IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM task_control_completion_inbox i
                  WHERE i.recipient_id = ${recipient} AND i.task_id = a.id AND i.completed_at = a.completed_at
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
        FROM (SELECT task_id, title, business_context, completed_at, micros::text AS micros, read_at
              FROM keyed ${condition} ORDER BY completed_at DESC, task_id DESC LIMIT ${PAGE_SIZE + 1}) p), '[]'::json)`;
    const { rows: [result] } = await db.query(`${sql}
        SELECT (SELECT COUNT(*)::int FROM keyed WHERE read_at IS NULL) AS unread, ${page} AS page`, params);
    const alerts = result.page.slice(0, PAGE_SIZE).map(event => ({
        id: `control_completed_${normalizeUserId(user)}_${event.task_id}_${event.micros}`,
        eventKey: `${event.task_id}:${event.micros}`,
        type: 'control_completion',
        level: 'info',
        icon: '✓',
        title: `Завершено: ${event.title || 'Задача без назви'}`,
        message: 'На контролі · Для ознайомлення',
        link: `/tasks?view=my&open=${event.task_id}&businessContext=${encodeURIComponent(event.business_context)}`,
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
