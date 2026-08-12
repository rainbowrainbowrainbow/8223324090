'use strict';

const { canAccessBusinessContext } = require('./businessContext');
const { myDayError } = require('./myDayTaxonomy');

const MAX_MANUAL_DURATION_MINUTES = 24 * 60;
const ACTIVE_TIMER_WARNING_SECONDS = 8 * 60 * 60;

function positiveInteger(value, field = 'ідентифікатор') {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw myDayError(`Некоректний ${field}.`, 400, 'MY_DAY_TIME_VALIDATION_ERROR');
    }
    return parsed;
}

function normalizeLocalDate(value) {
    const date = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw myDayError('Дата має бути у форматі YYYY-MM-DD.', 400, 'MY_DAY_TIME_VALIDATION_ERROR');
    }
    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw myDayError('Некоректна дата.', 400, 'MY_DAY_TIME_VALIDATION_ERROR');
    }
    return date;
}

function normalizeLocalTime(value) {
    const time = String(value || '').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) {
        throw myDayError('Час має бути у форматі HH:MM.', 400, 'MY_DAY_TIME_VALIDATION_ERROR');
    }
    return time.length === 5 ? `${time}:00` : time;
}

function normalizeDurationMinutes(value) {
    const duration = Number(value);
    if (!Number.isInteger(duration) || duration <= 0 || duration > MAX_MANUAL_DURATION_MINUTES) {
        throw myDayError('Тривалість має бути від 1 хвилини до 24 годин.', 400, 'MY_DAY_TIME_VALIDATION_ERROR');
    }
    return duration;
}

function serializeEntry(row = {}, now = new Date()) {
    const startedAt = row.started_at || row.startedAt || null;
    const endedAt = row.ended_at || row.endedAt || null;
    const durationSeconds = Number(row.duration_seconds ?? row.durationSeconds ?? (
        startedAt ? Math.max(0, Math.floor(((endedAt ? new Date(endedAt) : now) - new Date(startedAt)) / 1000)) : 0
    ));
    return {
        id: Number(row.id),
        taskId: Number(row.task_id || row.taskId),
        startedAt,
        endedAt,
        source: row.source,
        durationSeconds,
        isActive: !endedAt,
        warning: !endedAt && durationSeconds >= ACTIVE_TIMER_WARNING_SECONDS ? 'long_running' : null,
        businessContext: row.task_business_context || row.business_context || null,
        task: row.task_id ? {
            id: Number(row.task_id),
            title: row.task_title || null,
            status: row.task_status || null,
            businessContext: row.task_business_context || null
        } : null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function publicTimerEntry(entry = {}, options = {}) {
    if (!entry) return null;
    const durationSeconds = Number(entry.durationSeconds ?? entry.duration_seconds ?? 0);
    const base = {
        startedAt: entry.startedAt || entry.started_at || null,
        durationSeconds: Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0,
        isActive: entry.isActive !== false && !(entry.endedAt || entry.ended_at),
        warning: entry.warning || null
    };
    if (options.includeTask === false) {
        return {
            ...base,
            taskUnavailable: true,
            task: null
        };
    }
    const task = entry.task || null;
    const businessContext = entry.businessContext || entry.business_context || task?.businessContext || task?.business_context || null;
    return {
        id: entry.id ? Number(entry.id) : null,
        taskId: entry.taskId ? Number(entry.taskId) : Number(entry.task_id || task?.id || 0),
        ...base,
        endedAt: entry.endedAt || entry.ended_at || null,
        source: entry.source || null,
        businessContext,
        taskUnavailable: false,
        task: task ? {
            id: Number(task.id || entry.taskId || entry.task_id || 0),
            title: task.title || null,
            status: task.status || null,
            businessContext
        } : null,
        createdAt: entry.createdAt || entry.created_at || null,
        updatedAt: entry.updatedAt || entry.updated_at || null
    };
}

function sanitizeTimerForBusinessAccess(entry, user) {
    if (!entry) return null;
    const businessContext = entry.businessContext || entry.business_context || entry.task?.businessContext || entry.task?.business_context;
    if (!businessContext || canAccessBusinessContext(user, businessContext)) {
        return publicTimerEntry(entry, { includeTask: true });
    }
    return publicTimerEntry(entry, { includeTask: false });
}

async function activeTimer(queryable, userId, options = {}) {
    const lock = options.lock === true ? ' FOR UPDATE' : '';
    const result = await queryable.query(
        `SELECT e.*, t.title AS task_title, t.status AS task_status, t.business_context AS task_business_context,
                GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - e.started_at))))::int AS duration_seconds
         FROM my_day_time_entries e
         JOIN tasks t ON t.id = e.task_id
         WHERE e.user_id = $1 AND e.ended_at IS NULL
         ORDER BY e.started_at DESC, e.id DESC
         LIMIT 1${lock}`,
        [positiveInteger(userId, 'користувач')]
    );
    return result.rows?.[0] ? serializeEntry(result.rows[0]) : null;
}

async function stopActiveTimerForUser(queryable, userId, options = {}) {
    const params = [positiveInteger(userId, 'користувач')];
    const taskCondition = options.taskId ? ` AND task_id = $${params.push(positiveInteger(options.taskId))}` : '';
    const result = await queryable.query(
        `UPDATE my_day_time_entries
         SET ended_at = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND ended_at IS NULL${taskCondition}
         RETURNING *, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (ended_at - started_at))))::int AS duration_seconds`,
        params
    );
    return result.rows?.[0] ? serializeEntry(result.rows[0]) : null;
}

async function startTimer(queryable, input = {}) {
    const userId = positiveInteger(input.userId, 'користувач');
    const taskId = positiveInteger(input.taskId, 'задачі');
    const existing = await activeTimer(queryable, userId, { lock: true });
    if (existing?.taskId === taskId) return { entry: existing, unchanged: true, switchedFromTaskId: null };
    let switchedFromTaskId = null;
    if (existing) {
        switchedFromTaskId = existing.taskId;
        await stopActiveTimerForUser(queryable, userId);
    }
    try {
        const result = await queryable.query(
            `INSERT INTO my_day_time_entries (user_id, task_id, started_at, source)
             VALUES ($1, $2, NOW(), 'timer')
             RETURNING *, 0::int AS duration_seconds`,
            [userId, taskId]
        );
        return { entry: serializeEntry(result.rows[0]), unchanged: false, switchedFromTaskId };
    } catch (error) {
        if (error?.code === '23505') throw myDayError('Вже запущено інший таймер. Спробуйте ще раз.', 409, 'MY_DAY_TIMER_CONFLICT');
        throw error;
    }
}

async function assertNoOverlap(queryable, input = {}) {
    const userId = positiveInteger(input.userId, 'користувач');
    const excludedId = input.excludedId ? positiveInteger(input.excludedId, 'запис') : null;
    const result = await queryable.query(
        `SELECT id
         FROM my_day_time_entries
         WHERE user_id = $1
           AND started_at < $3::timestamptz
           AND COALESCE(ended_at, NOW()) > $2::timestamptz
           ${excludedId ? 'AND id <> $4' : ''}
         LIMIT 1`,
        excludedId ? [userId, input.startedAt, input.endedAt, excludedId] : [userId, input.startedAt, input.endedAt]
    );
    if (result.rows?.length) throw myDayError('Запис часу перетинається з іншим записом.', 409, 'MY_DAY_TIME_OVERLAP');
}

async function manualInterval(queryable, payload = {}) {
    const localDate = normalizeLocalDate(payload.localDate ?? payload.local_date);
    const startTime = normalizeLocalTime(payload.startTime ?? payload.start_time);
    const durationMinutes = normalizeDurationMinutes(payload.durationMinutes ?? payload.duration_minutes);
    const result = await queryable.query(
        `SELECT (($1::date + $2::time) AT TIME ZONE 'Europe/Kyiv') AS started_at,
                (($1::date + $2::time) AT TIME ZONE 'Europe/Kyiv') + ($3::int * INTERVAL '1 minute') AS ended_at`,
        [localDate, startTime, durationMinutes]
    );
    return { ...result.rows[0], localDate, startTime, durationMinutes };
}

async function createManualEntry(queryable, input = {}) {
    const userId = positiveInteger(input.userId, 'користувач');
    const taskId = positiveInteger(input.taskId, 'задачі');
    const interval = await manualInterval(queryable, input);
    await assertNoOverlap(queryable, { userId, startedAt: interval.started_at, endedAt: interval.ended_at });
    const result = await queryable.query(
        `INSERT INTO my_day_time_entries (user_id, task_id, started_at, ended_at, source)
         VALUES ($1, $2, $3, $4, 'manual')
         RETURNING *, FLOOR(EXTRACT(EPOCH FROM (ended_at - started_at)))::int AS duration_seconds`,
        [userId, taskId, interval.started_at, interval.ended_at]
    );
    return serializeEntry(result.rows[0]);
}

async function updateManualEntry(queryable, input = {}) {
    const userId = positiveInteger(input.userId, 'користувач');
    const entryId = positiveInteger(input.entryId, 'запис');
    const current = await queryable.query(
        `SELECT * FROM my_day_time_entries WHERE id = $1 AND user_id = $2 FOR UPDATE`, [entryId, userId]
    );
    if (!current.rows?.[0]) throw myDayError('Запис часу не знайдено.', 404, 'MY_DAY_TIME_ENTRY_NOT_FOUND');
    const interval = await manualInterval(queryable, input);
    await assertNoOverlap(queryable, { userId, startedAt: interval.started_at, endedAt: interval.ended_at, excludedId: entryId });
    const result = await queryable.query(
        `UPDATE my_day_time_entries
         SET started_at = $3, ended_at = $4, source = 'manual', updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *, FLOOR(EXTRACT(EPOCH FROM (ended_at - started_at)))::int AS duration_seconds`,
        [entryId, userId, interval.started_at, interval.ended_at]
    );
    return serializeEntry(result.rows[0]);
}

async function deleteTimeEntry(queryable, userId, entryId) {
    const result = await queryable.query(
        `DELETE FROM my_day_time_entries WHERE id = $1 AND user_id = $2 RETURNING id`,
        [positiveInteger(entryId, 'запис'), positiveInteger(userId, 'користувач')]
    );
    if (!result.rows?.length) throw myDayError('Запис часу не знайдено.', 404, 'MY_DAY_TIME_ENTRY_NOT_FOUND');
}

async function listTimeEntries(queryable, userId, options = {}) {
    const from = normalizeLocalDate(options.from);
    const to = normalizeLocalDate(options.to);
    if (from > to) throw myDayError('Дата початку не може бути пізніше дати завершення.', 400, 'MY_DAY_TIME_VALIDATION_ERROR');
    const result = await queryable.query(
        `SELECT e.*, t.title AS task_title, t.status AS task_status,
                GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(e.ended_at, NOW()) - e.started_at))))::int AS duration_seconds
         FROM my_day_time_entries e
         JOIN tasks t ON t.id = e.task_id
         WHERE e.user_id = $1
           AND e.started_at < (($3::date + 1)::timestamp AT TIME ZONE 'Europe/Kyiv')
           AND COALESCE(e.ended_at, NOW()) >= ($2::date::timestamp AT TIME ZONE 'Europe/Kyiv')
         ORDER BY e.started_at DESC, e.id DESC`,
        [positiveInteger(userId, 'користувач'), from, to]
    );
    return (result.rows || []).map(row => serializeEntry(row));
}

async function loadTaskTimeTotals(queryable, userId, taskIds = []) {
    const ids = [...new Set(Array.from(taskIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
    if (!ids.length) return new Map();
    const result = await queryable.query(
        `SELECT task_id,
                COALESCE(SUM(GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at))))), 0)::int AS actual_seconds
         FROM my_day_time_entries
         WHERE user_id = $1 AND task_id = ANY($2::int[])
         GROUP BY task_id`,
        [positiveInteger(userId, 'користувач'), ids]
    );
    return new Map((result.rows || []).map(row => [Number(row.task_id), Number(row.actual_seconds || 0)]));
}

module.exports = {
    ACTIVE_TIMER_WARNING_SECONDS,
    MAX_MANUAL_DURATION_MINUTES,
    activeTimer,
    createManualEntry,
    deleteTimeEntry,
    listTimeEntries,
    loadTaskTimeTotals,
    manualInterval,
    publicTimerEntry,
    sanitizeTimerForBusinessAccess,
    startTimer,
    stopActiveTimerForUser,
    updateManualEntry
};
