'use strict';

const {
    myDayError,
    normalizeImpactIds,
    normalizeName
} = require('./myDayTaxonomy');

const HABIT_METRICS = new Set(['boolean', 'count', 'minutes']);
const HABIT_CADENCES = new Set(['daily', 'selected_weekdays', 'times_per_week']);
const KYIV_TIMEZONE = 'Europe/Kyiv';

function positiveInteger(value, field = 'identifier') {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw myDayError(`Invalid ${field}.`, 400, 'MY_DAY_HABIT_VALIDATION');
    }
    return parsed;
}

function optionalPositiveInteger(value, field = 'identifier') {
    if (value === null || value === undefined || value === '') return null;
    return positiveInteger(value, field);
}

function normalizeLocalDate(value) {
    const date = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw myDayError('Date must be YYYY-MM-DD in Europe/Kyiv.', 400, 'MY_DAY_HABIT_VALIDATION');
    }
    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw myDayError('Invalid local date.', 400, 'MY_DAY_HABIT_VALIDATION');
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

function isoWeekday(localDate) {
    const day = new Date(`${normalizeLocalDate(localDate)}T12:00:00Z`).getUTCDay();
    return day === 0 ? 7 : day;
}

function weekRange(localDate) {
    const date = new Date(`${normalizeLocalDate(localDate)}T12:00:00Z`);
    const weekday = isoWeekday(localDate);
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - weekday + 1);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return {
        from: monday.toISOString().slice(0, 10),
        to: sunday.toISOString().slice(0, 10)
    };
}

function normalizeWeekdays(value) {
    const source = Array.isArray(value) ? value : [];
    const weekdays = source.map(Number).filter(Number.isInteger);
    const unique = [...new Set(weekdays)].sort((a, b) => a - b);
    if (unique.length !== weekdays.length || unique.some(day => day < 1 || day > 7)) {
        throw myDayError('Weekdays must be unique ISO days 1-7.', 400, 'MY_DAY_HABIT_VALIDATION');
    }
    return unique;
}

function parsePgArray(value) {
    if (Array.isArray(value)) return value.map(Number).filter(Number.isInteger);
    if (typeof value !== 'string') return [];
    return value.replace(/[{}]/g, '').split(',').map(Number).filter(Number.isInteger);
}

function normalizeHabitPayload(input = {}, current = {}) {
    const has = key => Object.hasOwn(input, key);
    const name = has('name') ? normalizeName(input.name) : current.name;
    const metric = String(has('metric') ? input.metric : (current.metric || 'boolean'));
    const cadence = String(has('cadence') ? input.cadence : (current.cadence || 'daily'));
    if (!HABIT_METRICS.has(metric)) throw myDayError('Unsupported habit metric.', 400, 'MY_DAY_HABIT_VALIDATION');
    if (!HABIT_CADENCES.has(cadence)) throw myDayError('Unsupported habit cadence.', 400, 'MY_DAY_HABIT_VALIDATION');

    const rawTarget = has('targetValue') ? input.targetValue : (has('target_value') ? input.target_value : (current.target_value ?? current.targetValue ?? 1));
    const targetValue = Number(rawTarget);
    if (!Number.isInteger(targetValue) || targetValue < 1 || (metric === 'boolean' && targetValue !== 1)) {
        throw myDayError('Invalid habit target.', 400, 'MY_DAY_HABIT_VALIDATION');
    }

    const rawWeekdays = has('selectedWeekdays') ? input.selectedWeekdays
        : (has('selected_weekdays') ? input.selected_weekdays : (current.selected_weekdays ?? current.selectedWeekdays ?? []));
    const selectedWeekdays = cadence === 'selected_weekdays' ? normalizeWeekdays(rawWeekdays) : [];
    if (cadence === 'selected_weekdays' && selectedWeekdays.length === 0) {
        throw myDayError('Selected weekdays cadence requires at least one day.', 400, 'MY_DAY_HABIT_VALIDATION');
    }

    const rawTimesPerWeek = has('timesPerWeek') ? input.timesPerWeek
        : (has('times_per_week') ? input.times_per_week : (current.times_per_week ?? current.timesPerWeek ?? null));
    const timesPerWeek = cadence === 'times_per_week' ? Number(rawTimesPerWeek) : null;
    if (cadence === 'times_per_week' && (!Number.isInteger(timesPerWeek) || timesPerWeek < 1 || timesPerWeek > 7)) {
        throw myDayError('Weekly habit target must be 1-7.', 400, 'MY_DAY_HABIT_VALIDATION');
    }

    const directionId = has('directionId') ? optionalPositiveInteger(input.directionId, 'direction')
        : (has('direction_id') ? optionalPositiveInteger(input.direction_id, 'direction')
            : optionalPositiveInteger(current.direction_id ?? current.directionId ?? null, 'direction'));
    const impactIds = has('impactIds') ? normalizeImpactIds(input.impactIds)
        : (has('impact_ids') ? normalizeImpactIds(input.impact_ids) : normalizeImpactIds(current.impactIds || []));

    const sortOrder = has('sortOrder') || has('sort_order') ? Number(input.sortOrder ?? input.sort_order)
        : Number(current.sort_order ?? current.sortOrder ?? 0);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000000) {
        throw myDayError('Invalid habit sort order.', 400, 'MY_DAY_HABIT_VALIDATION');
    }

    const isPaused = has('isPaused') ? input.isPaused : (has('is_paused') ? input.is_paused : (current.is_paused ?? current.isPaused ?? false));
    const isArchived = has('isArchived') ? input.isArchived : (has('is_archived') ? input.is_archived : (current.is_archived ?? current.isArchived ?? false));
    if (typeof isPaused !== 'boolean' || typeof isArchived !== 'boolean') {
        throw myDayError('Habit state flags must be boolean.', 400, 'MY_DAY_HABIT_VALIDATION');
    }

    return {
        name,
        metric,
        targetValue,
        cadence,
        selectedWeekdays,
        timesPerWeek,
        directionId,
        impactIds,
        sortOrder,
        isPaused,
        isArchived
    };
}

async function ensureTaxonomyOwnership(queryable, userId, directionId, impactIds) {
    const ownerId = positiveInteger(userId, 'user');
    if (directionId) {
        const direction = await queryable.query(
            'SELECT id, is_active FROM my_day_directions WHERE id = $1 AND user_id = $2 LIMIT 1',
            [positiveInteger(directionId, 'direction'), ownerId]
        );
        if (!direction.rows?.[0]) throw myDayError('Direction is not available.', 404, 'MY_DAY_HABIT_TAXONOMY_NOT_FOUND');
        if (direction.rows[0].is_active === false) throw myDayError('Archived direction cannot be selected.', 409, 'MY_DAY_HABIT_TAXONOMY_ARCHIVED');
    }
    const ids = normalizeImpactIds(impactIds || []);
    if (!ids.length) return;
    const impacts = await queryable.query(
        'SELECT id, is_active FROM my_day_impacts WHERE user_id = $1 AND id = ANY($2::bigint[])',
        [ownerId, ids]
    );
    if ((impacts.rows || []).length !== ids.length) throw myDayError('Impact is not available.', 404, 'MY_DAY_HABIT_TAXONOMY_NOT_FOUND');
    if (impacts.rows.some(row => row.is_active === false)) throw myDayError('Archived impact cannot be selected.', 409, 'MY_DAY_HABIT_TAXONOMY_ARCHIVED');
}

function isHabitDue(row, localDate) {
    if (row.is_paused || row.is_archived) return false;
    if (row.cadence === 'daily') return true;
    if (row.cadence === 'selected_weekdays') {
        return parsePgArray(row.selected_weekdays).includes(isoWeekday(localDate));
    }
    if (row.cadence === 'times_per_week') return true;
    return false;
}

function normalizeJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
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

function completedFrom(row = {}) {
    if (row.checkin_state !== 'done') return false;
    const value = Number(row.checkin_value || 0);
    return row.metric === 'boolean' ? value >= 1 : value >= Number(row.target_value || 1);
}

function serializeHabit(row = {}, localDate = kyivToday()) {
    const impactRows = normalizeJsonArray(row.impacts);
    const weeklyTarget = row.cadence === 'times_per_week' ? Number(row.times_per_week || 0) : null;
    const weeklyCompleted = Number(row.weekly_completed || 0);
    const checkin = row.checkin_state ? {
        state: row.checkin_state,
        value: Number(row.checkin_value || 0),
        completed: completedFrom(row)
    } : null;
    return {
        id: Number(row.id),
        name: row.name,
        metric: row.metric,
        targetValue: Number(row.target_value || 1),
        cadence: row.cadence,
        selectedWeekdays: parsePgArray(row.selected_weekdays),
        timesPerWeek: weeklyTarget,
        isPaused: row.is_paused === true,
        isArchived: row.is_archived === true,
        sortOrder: Number(row.sort_order || 0),
        direction: serializeDirection(row),
        impacts: impactRows.map(impact => ({
            id: Number(impact.id),
            name: impact.name,
            color: impact.color,
            icon: impact.icon,
            isActive: impact.isActive !== false && impact.is_active !== false
        })),
        localDate,
        isDue: isHabitDue(row, localDate),
        checkin,
        completed: checkin?.completed === true,
        skipped: checkin?.state === 'skipped',
        progress: {
            value: Number(row.checkin_value || 0),
            target: Number(row.target_value || 1),
            completed: checkin?.completed === true
        },
        weeklyProgress: weeklyTarget ? {
            completed: weeklyCompleted,
            target: weeklyTarget,
            remaining: Math.max(0, weeklyTarget - weeklyCompleted)
        } : null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

async function loadHabitRows(queryable, userId, options = {}) {
    const localDate = normalizeLocalDate(options.date || kyivToday());
    const includeArchived = options.includeArchived === true;
    const range = weekRange(localDate);
    const result = await queryable.query(
        `SELECT h.*,
                d.id AS direction_id,
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
                )) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS impacts,
                c.state AS checkin_state,
                c.value AS checkin_value,
                COUNT(wc.id) FILTER (
                    WHERE wc.state = 'done'
                      AND CASE WHEN h.metric = 'boolean' THEN wc.value >= 1 ELSE wc.value >= h.target_value END
                )::int AS weekly_completed
         FROM my_day_habits h
         LEFT JOIN my_day_directions d ON d.id = h.direction_id
         LEFT JOIN my_day_habit_impacts hi ON hi.habit_id = h.id AND hi.user_id = h.user_id
         LEFT JOIN my_day_impacts i ON i.id = hi.impact_id
         LEFT JOIN my_day_habit_checkins c ON c.habit_id = h.id AND c.user_id = h.user_id AND c.local_date = $2::date
         LEFT JOIN my_day_habit_checkins wc ON wc.habit_id = h.id AND wc.user_id = h.user_id AND wc.local_date BETWEEN $3::date AND $4::date
         WHERE h.user_id = $1 ${includeArchived ? '' : 'AND h.is_archived = FALSE'}
         GROUP BY h.id, d.id, d.name, d.color, d.icon, d.is_active, c.state, c.value
         ORDER BY h.is_archived ASC, h.is_paused ASC, h.sort_order ASC, h.id ASC`,
        [positiveInteger(userId, 'user'), localDate, range.from, range.to]
    );
    return { rows: result.rows || [], localDate };
}

async function listHabits(queryable, userId, options = {}) {
    const { rows, localDate } = await loadHabitRows(queryable, userId, options);
    const habits = rows.map(row => serializeHabit(row, localDate));
    return options.includeArchived === true ? habits : habits.filter(habit => habit.isDue);
}

async function getHabit(queryable, userId, habitId, options = {}) {
    const includeArchived = options.includeArchived !== false;
    const result = await queryable.query(
        `SELECT h.*,
                COALESCE(array_agg(hi.impact_id ORDER BY hi.impact_id) FILTER (WHERE hi.impact_id IS NOT NULL), '{}') AS impact_ids
         FROM my_day_habits h
         LEFT JOIN my_day_habit_impacts hi ON hi.habit_id = h.id AND hi.user_id = h.user_id
         WHERE h.id = $1 AND h.user_id = $2 ${includeArchived ? '' : 'AND h.is_archived = FALSE'}
         GROUP BY h.id
         LIMIT 1`,
        [positiveInteger(habitId, 'habit'), positiveInteger(userId, 'user')]
    );
    const row = result.rows?.[0];
    if (!row) throw myDayError('Habit not found.', 404, 'MY_DAY_HABIT_NOT_FOUND');
    row.impactIds = parsePgArray(row.impact_ids);
    return row;
}

async function createHabit(queryable, userId, payload = {}) {
    const ownerId = positiveInteger(userId, 'user');
    const habit = normalizeHabitPayload(payload);
    await ensureTaxonomyOwnership(queryable, ownerId, habit.directionId, habit.impactIds);
    const result = await queryable.query(
        `INSERT INTO my_day_habits
            (user_id, name, direction_id, metric, target_value, cadence, selected_weekdays, times_per_week, is_paused, is_archived, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7::smallint[], $8, $9, $10, $11)
         RETURNING *`,
        [ownerId, habit.name, habit.directionId, habit.metric, habit.targetValue, habit.cadence, habit.selectedWeekdays, habit.timesPerWeek, habit.isPaused, habit.isArchived, habit.sortOrder]
    );
    if (habit.impactIds.length) {
        await queryable.query(
            `INSERT INTO my_day_habit_impacts (habit_id, user_id, impact_id)
             SELECT $1, $2, unnest($3::bigint[])`,
            [result.rows[0].id, ownerId, habit.impactIds]
        );
    }
    return serializeHabit({ ...result.rows[0], impacts: [], weekly_completed: 0 }, kyivToday());
}

async function updateHabit(queryable, userId, habitId, payload = {}) {
    const ownerId = positiveInteger(userId, 'user');
    const current = await getHabit(queryable, ownerId, habitId);
    const habit = normalizeHabitPayload(payload, current);
    await ensureTaxonomyOwnership(queryable, ownerId, habit.directionId, habit.impactIds);
    const result = await queryable.query(
        `UPDATE my_day_habits
         SET name = $3,
             direction_id = $4,
             metric = $5,
             target_value = $6,
             cadence = $7,
             selected_weekdays = $8::smallint[],
             times_per_week = $9,
             is_paused = $10,
             is_archived = $11,
             archived_at = CASE WHEN $11 THEN COALESCE(archived_at, NOW()) ELSE NULL END,
             sort_order = $12,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [positiveInteger(habitId, 'habit'), ownerId, habit.name, habit.directionId, habit.metric, habit.targetValue, habit.cadence, habit.selectedWeekdays, habit.timesPerWeek, habit.isPaused, habit.isArchived, habit.sortOrder]
    );
    await queryable.query('DELETE FROM my_day_habit_impacts WHERE habit_id = $1 AND user_id = $2', [habitId, ownerId]);
    if (habit.impactIds.length) {
        await queryable.query(
            `INSERT INTO my_day_habit_impacts (habit_id, user_id, impact_id)
             SELECT $1, $2, unnest($3::bigint[])
             ON CONFLICT (habit_id, impact_id) DO NOTHING`,
            [habitId, ownerId, habit.impactIds]
        );
    }
    return serializeHabit({ ...result.rows[0], impacts: [], weekly_completed: 0 }, kyivToday());
}

function normalizeCheckinPayload(habit, payload = {}) {
    const state = payload.state === 'skipped' ? 'skipped' : 'done';
    const rawValue = payload.value ?? (state === 'skipped' ? 0 : (habit.metric === 'boolean' ? 1 : 0));
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0) {
        throw myDayError('Invalid check-in value.', 400, 'MY_DAY_HABIT_VALIDATION');
    }
    return { state, value: state === 'skipped' ? 0 : value };
}

async function upsertCheckin(queryable, userId, habitId, localDate, payload = {}) {
    const ownerId = positiveInteger(userId, 'user');
    const date = normalizeLocalDate(localDate);
    const habit = await getHabit(queryable, ownerId, habitId, { includeArchived: false });
    if (habit.is_paused) throw myDayError('Paused habit cannot be checked in.', 409, 'MY_DAY_HABIT_PAUSED');
    const checkin = normalizeCheckinPayload(habit, payload);
    const result = await queryable.query(
        `INSERT INTO my_day_habit_checkins (habit_id, user_id, local_date, state, value)
         VALUES ($1, $2, $3::date, $4, $5)
         ON CONFLICT (habit_id, user_id, local_date)
         DO UPDATE SET state = EXCLUDED.state, value = EXCLUDED.value, updated_at = NOW()
         RETURNING *`,
        [positiveInteger(habitId, 'habit'), ownerId, date, checkin.state, checkin.value]
    );
    return {
        id: Number(result.rows[0].id),
        habitId: Number(result.rows[0].habit_id),
        userId: Number(result.rows[0].user_id),
        localDate: result.rows[0].local_date,
        state: result.rows[0].state,
        value: Number(result.rows[0].value || 0),
        completed: result.rows[0].state === 'done' && (habit.metric === 'boolean' ? Number(result.rows[0].value) >= 1 : Number(result.rows[0].value) >= Number(habit.target_value || 1))
    };
}

async function deleteCheckin(queryable, userId, habitId, localDate) {
    await queryable.query(
        'DELETE FROM my_day_habit_checkins WHERE habit_id = $1 AND user_id = $2 AND local_date = $3::date',
        [positiveInteger(habitId, 'habit'), positiveInteger(userId, 'user'), normalizeLocalDate(localDate)]
    );
}

module.exports = {
    HABIT_CADENCES,
    HABIT_METRICS,
    KYIV_TIMEZONE,
    createHabit,
    deleteCheckin,
    ensureTaxonomyOwnership,
    getHabit,
    isHabitDue,
    isoWeekday,
    kyivToday,
    listHabits,
    normalizeHabitPayload,
    normalizeLocalDate,
    positiveInteger,
    serializeHabit,
    updateHabit,
    upsertCheckin,
    weekRange
};
