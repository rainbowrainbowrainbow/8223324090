'use strict';

const { myDayError } = require('./myDayTaxonomy');
const { normalizeUserId, buildTaskOwnerMatch } = require('./taskPolicy');
const { appendTaskBusinessScopeSql, taskBusinessScopeMeta } = require('./taskBusinessScope');

const KYIV_TIMEZONE = 'Europe/Kyiv';
const MAX_RANGE_DAYS = 92;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const UNCLASSIFIED_KEY = 'unclassified';

function normalizeLocalDate(value, field = 'date') {
    const label = field === 'from' ? 'початку' : (field === 'to' ? 'завершення' : 'дати');
    const date = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw myDayError(`Дата ${label} має бути у форматі YYYY-MM-DD для ${KYIV_TIMEZONE}.`, 400, 'MY_DAY_CONTRIBUTION_VALIDATION');
    }
    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw myDayError(`Некоректна дата ${label}.`, 400, 'MY_DAY_CONTRIBUTION_VALIDATION');
    }
    return date;
}

function kyivToday(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: KYIV_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function addDays(localDate, delta) {
    const date = new Date(`${normalizeLocalDate(localDate)}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Number(delta || 0));
    return date.toISOString().slice(0, 10);
}

function dayCount(from, to) {
    return Math.floor((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / MS_PER_DAY) + 1;
}

function normalizeRange(query = {}, now = new Date()) {
    const fallbackTo = kyivToday(now);
    const to = normalizeLocalDate(query.to || fallbackTo, 'to');
    const from = normalizeLocalDate(query.from || addDays(to, -6), 'from');
    const count = dayCount(from, to);
    if (count < 1) throw myDayError('Дата початку має бути не пізніше дати завершення.', 400, 'MY_DAY_CONTRIBUTION_VALIDATION');
    if (count > MAX_RANGE_DAYS) throw myDayError('Період внеску не може перевищувати 92 дні.', 400, 'MY_DAY_CONTRIBUTION_RANGE_TOO_LARGE');
    return { from, to, dayCount: count, timezone: KYIV_TIMEZONE };
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function numberValue(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
}

function serializeDirection(row = {}) {
    if (!row.direction_id) return null;
    return {
        id: Number(row.direction_id),
        name: row.direction_name,
        color: row.direction_color,
        icon: row.direction_icon,
        isActive: row.direction_is_active !== false
    };
}

function serializeImpact(impact = {}) {
    return {
        id: Number(impact.id),
        name: impact.name,
        color: impact.color,
        icon: impact.icon,
        isActive: impact.isActive !== false && impact.is_active !== false
    };
}

function emptyTotals() {
    return { taskCount: 0, taskMinutes: 0, habitCompletions: 0, habitMinutes: 0 };
}

function increment(target, delta = {}) {
    target.taskCount += numberValue(delta.taskCount);
    target.taskMinutes += numberValue(delta.taskMinutes);
    target.habitCompletions += numberValue(delta.habitCompletions);
    target.habitMinutes += numberValue(delta.habitMinutes);
}

function bucket(map, key, label, taxonomy = null) {
    if (!map.has(key)) {
        map.set(key, {
            key,
            label,
            taxonomy,
            ...emptyTotals()
        });
    }
    return map.get(key);
}

function directionBucket(matrix, direction) {
    if (!direction) return matrix.unclassified;
    return bucket(matrix.directionsMap, `direction:${direction.id}`, direction.name, direction);
}

function impactBuckets(matrix, impacts = []) {
    return impacts
        .filter(impact => impact && impact.id)
        .map(impact => bucket(matrix.impactsMap, `impact:${impact.id}`, impact.name, impact));
}

function dayBucket(matrix, localDate) {
    return bucket(matrix.daysMap, localDate, localDate, null);
}

function createMatrix(range, businessScope = null) {
    return {
        success: true,
        range: {
            from: range.from,
            to: range.to,
            timezone: KYIV_TIMEZONE,
            dayCount: range.dayCount
        },
        totals: emptyTotals(),
        directionsMap: new Map(),
        impactsMap: new Map(),
        daysMap: new Map(),
        unclassified: {
            key: UNCLASSIFIED_KEY,
            label: 'Без напряму',
            taxonomy: null,
            ...emptyTotals()
        },
        meta: {
            businessScope: taskBusinessScopeMeta(businessScope || {})
        }
    };
}

function addCompletedTask(matrix, row = {}) {
    const localDate = row.local_date || row.completed_local_date;
    const direction = serializeDirection(row);
    const impacts = parseJsonArray(row.impacts).map(serializeImpact);
    const delta = { taskCount: 1 };
    increment(matrix.totals, delta);
    increment(directionBucket(matrix, direction), delta);
    impactBuckets(matrix, impacts).forEach(item => increment(item, delta));
    if (localDate) increment(dayBucket(matrix, localDate), delta);
}

function addTaskTime(matrix, row = {}) {
    const minutes = Math.round(numberValue(row.seconds) / 60);
    if (minutes <= 0) return;
    const direction = serializeDirection(row);
    const impacts = parseJsonArray(row.impacts).map(serializeImpact);
    const delta = { taskMinutes: minutes };
    increment(matrix.totals, delta);
    increment(directionBucket(matrix, direction), delta);
    impactBuckets(matrix, impacts).forEach(item => increment(item, delta));
    if (row.local_date) increment(dayBucket(matrix, row.local_date), delta);
}

function habitCompleted(row = {}) {
    if (row.state !== 'done') return false;
    const value = numberValue(row.value);
    return row.metric === 'boolean' ? value >= 1 : value >= numberValue(row.target_value || 1);
}

function addHabitCompletion(matrix, row = {}) {
    if (!habitCompleted(row)) return;
    const direction = serializeDirection(row);
    const impacts = parseJsonArray(row.impacts).map(serializeImpact);
    const delta = {
        habitCompletions: 1,
        habitMinutes: row.metric === 'minutes' ? numberValue(row.value) : 0
    };
    increment(matrix.totals, delta);
    increment(directionBucket(matrix, direction), delta);
    impactBuckets(matrix, impacts).forEach(item => increment(item, delta));
    if (row.local_date) increment(dayBucket(matrix, row.local_date), delta);
}

function finalizeMatrix(matrix) {
    const serializeBucket = item => ({
        key: item.key,
        label: item.label,
        taxonomy: item.taxonomy,
        taskCount: item.taskCount,
        taskMinutes: item.taskMinutes,
        habitCompletions: item.habitCompletions,
        habitMinutes: item.habitMinutes
    });
    const sortBuckets = (a, b) => (
        (b.taskCount + b.habitCompletions) - (a.taskCount + a.habitCompletions)
        || (b.taskMinutes + b.habitMinutes) - (a.taskMinutes + a.habitMinutes)
        || String(a.label).localeCompare(String(b.label), 'uk')
    );
    const days = [];
    for (let date = matrix.range.from; date <= matrix.range.to; date = addDays(date, 1)) {
        const item = matrix.daysMap.get(date) || { key: date, label: date, ...emptyTotals() };
        days.push({
            date,
            taskCount: item.taskCount,
            taskMinutes: item.taskMinutes,
            habitCompletions: item.habitCompletions,
            habitMinutes: item.habitMinutes
        });
    }
    return {
        success: true,
        range: matrix.range,
        totals: matrix.totals,
        directions: [...matrix.directionsMap.values()].sort(sortBuckets).map(serializeBucket),
        impacts: [...matrix.impactsMap.values()].sort(sortBuckets).map(serializeBucket),
        unclassified: serializeBucket(matrix.unclassified),
        days,
        meta: matrix.meta
    };
}

function summarizeContribution({ range, businessScope, completedTasks = [], taskTimeRows = [], habitRows = [] }) {
    const matrix = createMatrix(range, businessScope);
    completedTasks.forEach(row => addCompletedTask(matrix, row));
    taskTimeRows.forEach(row => addTaskTime(matrix, row));
    habitRows.forEach(row => addHabitCompletion(matrix, row));
    return finalizeMatrix(matrix);
}

async function queryCompletedTasks(queryable, user, userId, businessScope, range) {
    const params = [];
    const ownerMatch = buildTaskOwnerMatch(user, params, 't');
    const businessCondition = appendTaskBusinessScopeSql(params, businessScope, 't');
    params.push(userId);
    const userParam = params.length;
    params.push(range.from);
    const fromParam = params.length;
    params.push(range.to);
    const toParam = params.length;
    const result = await queryable.query(
        `SELECT t.id AS task_id,
                (t.completed_at AT TIME ZONE '${KYIV_TIMEZONE}')::date::text AS local_date,
                m.direction_id,
                d.name AS direction_name,
                d.color AS direction_color,
                d.icon AS direction_icon,
                d.is_active AS direction_is_active,
                COALESCE(json_agg(json_build_object(
                    'id', i.id,
                    'name', i.name,
                    'color', i.color,
                    'icon', i.icon,
                    'isActive', i.is_active
                ) ORDER BY i.sort_order ASC, i.id ASC) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS impacts
         FROM tasks t
         LEFT JOIN my_day_task_metadata m ON m.user_id = $${userParam} AND m.task_id = t.id
         LEFT JOIN my_day_directions d ON d.id = m.direction_id
         LEFT JOIN my_day_task_impacts ti ON ti.user_id = $${userParam} AND ti.task_id = t.id
         LEFT JOIN my_day_impacts i ON i.id = ti.impact_id
         WHERE ${ownerMatch}
           ${businessCondition}
           AND COALESCE(t.status, 'todo') = 'done'
           AND t.completed_at IS NOT NULL
           AND (t.completed_at AT TIME ZONE '${KYIV_TIMEZONE}')::date BETWEEN $${fromParam}::date AND $${toParam}::date
         GROUP BY t.id, t.completed_at, m.direction_id, d.name, d.color, d.icon, d.is_active`,
        params
    );
    return result.rows || [];
}

async function queryTaskTimeRows(queryable, user, userId, businessScope, range) {
    const params = [];
    const businessCondition = appendTaskBusinessScopeSql(params, businessScope, 't');
    params.push(userId);
    const userParam = params.length;
    params.push(range.from);
    const fromParam = params.length;
    params.push(range.to);
    const toParam = params.length;
    const result = await queryable.query(
        `WITH days AS (
             SELECT generate_series($${fromParam}::date, $${toParam}::date, interval '1 day')::date AS local_date
         )
         SELECT e.task_id,
                days.local_date::text AS local_date,
                SUM(GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(COALESCE(e.ended_at, NOW()), ((days.local_date + 1)::timestamp AT TIME ZONE '${KYIV_TIMEZONE}'))
                    - GREATEST(e.started_at, (days.local_date::timestamp AT TIME ZONE '${KYIV_TIMEZONE}'))
                ))))::int AS seconds,
                m.direction_id,
                d.name AS direction_name,
                d.color AS direction_color,
                d.icon AS direction_icon,
                d.is_active AS direction_is_active,
                COALESCE(json_agg(DISTINCT jsonb_build_object(
                    'id', i.id,
                    'name', i.name,
                    'color', i.color,
                    'icon', i.icon,
                    'isActive', i.is_active
                )) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS impacts
         FROM my_day_time_entries e
         JOIN tasks t ON t.id = e.task_id
         JOIN days ON e.started_at < ((days.local_date + 1)::timestamp AT TIME ZONE '${KYIV_TIMEZONE}')
                  AND COALESCE(e.ended_at, NOW()) > (days.local_date::timestamp AT TIME ZONE '${KYIV_TIMEZONE}')
         LEFT JOIN my_day_task_metadata m ON m.user_id = $${userParam} AND m.task_id = t.id
         LEFT JOIN my_day_directions d ON d.id = m.direction_id
         LEFT JOIN my_day_task_impacts ti ON ti.user_id = $${userParam} AND ti.task_id = t.id
         LEFT JOIN my_day_impacts i ON i.id = ti.impact_id
         WHERE e.user_id = $${userParam}
           ${businessCondition}
           AND e.started_at < (($${toParam}::date + 1)::timestamp AT TIME ZONE '${KYIV_TIMEZONE}')
           AND COALESCE(e.ended_at, NOW()) > ($${fromParam}::date::timestamp AT TIME ZONE '${KYIV_TIMEZONE}')
         GROUP BY e.task_id, days.local_date, m.direction_id, d.name, d.color, d.icon, d.is_active`,
        params
    );
    return result.rows || [];
}

async function queryHabitRows(queryable, userId, range) {
    const result = await queryable.query(
        `SELECT h.id AS habit_id,
                h.metric,
                h.target_value,
                c.local_date::text AS local_date,
                c.state,
                c.value,
                h.direction_id,
                d.name AS direction_name,
                d.color AS direction_color,
                d.icon AS direction_icon,
                d.is_active AS direction_is_active,
                COALESCE(json_agg(DISTINCT jsonb_build_object(
                    'id', i.id,
                    'name', i.name,
                    'color', i.color,
                    'icon', i.icon,
                    'isActive', i.is_active
                )) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS impacts
         FROM my_day_habit_checkins c
         JOIN my_day_habits h ON h.id = c.habit_id AND h.user_id = c.user_id
         LEFT JOIN my_day_directions d ON d.id = h.direction_id
         LEFT JOIN my_day_habit_impacts hi ON hi.habit_id = h.id AND hi.user_id = h.user_id
         LEFT JOIN my_day_impacts i ON i.id = hi.impact_id
         WHERE c.user_id = $1
           AND c.local_date BETWEEN $2::date AND $3::date
         GROUP BY h.id, h.metric, h.target_value, c.local_date, c.state, c.value, h.direction_id, d.name, d.color, d.icon, d.is_active`,
        [userId, range.from, range.to]
    );
    return result.rows || [];
}

async function buildMyDayContribution({ pool, queryable, user, businessScope, query = {}, now } = {}) {
    const executor = queryable || pool;
    const userId = normalizeUserId(user);
    if (!executor || !userId) throw myDayError('Потрібна авторизація.', 401, 'MY_DAY_CONTRIBUTION_AUTH_REQUIRED');
    const range = normalizeRange(query, now);
    const [completedTasks, taskTimeRows, habitRows] = await Promise.all([
        queryCompletedTasks(executor, user, userId, businessScope, range),
        queryTaskTimeRows(executor, user, userId, businessScope, range),
        queryHabitRows(executor, userId, range)
    ]);
    return summarizeContribution({ range, businessScope, completedTasks, taskTimeRows, habitRows });
}

module.exports = {
    KYIV_TIMEZONE,
    MAX_RANGE_DAYS,
    addDays,
    buildMyDayContribution,
    habitCompleted,
    normalizeRange,
    summarizeContribution
};
