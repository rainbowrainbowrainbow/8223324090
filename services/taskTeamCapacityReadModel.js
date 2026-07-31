'use strict';

const { addDays, todayKyivDate } = require('./taskScheduling');

const MAX_PLANNING_DAYS = 31;

function normalizeDate(value, fallback) {
    const raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

function normalizeTaskPlanningRange(input = {}, now = new Date()) {
    const today = todayKyivDate(now);
    const from = normalizeDate(input.from || input.dateFrom || input.date_from, today);
    const requestedTo = normalizeDate(input.to || input.dateTo || input.date_to, addDays(from, 6));
    const maxTo = addDays(from, MAX_PLANNING_DAYS - 1);
    return { from, to: requestedTo < from ? from : (requestedTo > maxTo ? maxTo : requestedTo) };
}

function ownerUserIds(tasks = []) {
    return [...new Set(tasks
        .map(task => Number(task.ownerUserId || task.owner_user_id || 0))
        .filter(id => Number.isInteger(id) && id > 0))];
}

async function loadTaskOwnerCapacity(db, tasks = [], range = {}) {
    const ownerIds = ownerUserIds(tasks);
    if (!ownerIds.length) return [];
    const result = await db.query(
        `WITH owner_staff AS (
            SELECT DISTINCT ON (ep.user_id)
                   ep.user_id AS owner_user_id,
                   ep.staff_id
            FROM employee_profiles ep
            WHERE ep.is_active = true
              AND ep.user_id = ANY($1::int[])
              AND ep.staff_id IS NOT NULL
            ORDER BY ep.user_id, ep.id DESC
         ),
         calendar AS (
            SELECT generate_series($2::date, $3::date, INTERVAL '1 day')::date AS day
         )
         SELECT os.owner_user_id,
                calendar.day::text AS date,
                CASE
                    WHEN COALESCE(hs.id, ss.id) IS NULL THEN 'unavailable'
                    ELSE 'available'
                END AS status,
                CASE
                    WHEN COALESCE(hs.id, ss.id) IS NULL THEN NULL
                    WHEN ss.status IS NOT NULL AND ss.status NOT IN ('working', 'remote') THEN 0
                    WHEN segment_minutes.minutes IS NOT NULL THEN segment_minutes.minutes
                    WHEN hs.planned_start IS NOT NULL AND hs.planned_end IS NOT NULL THEN
                        GREATEST(0, EXTRACT(EPOCH FROM (
                            CASE WHEN hs.planned_end <= hs.planned_start
                                THEN hs.planned_end + INTERVAL '1 day'
                                ELSE hs.planned_end END - hs.planned_start
                        )) / 60 - COALESCE(hs.break_minutes, 0))::int
                    WHEN ss.shift_start IS NOT NULL AND ss.shift_end IS NOT NULL THEN
                        GREATEST(0, EXTRACT(EPOCH FROM (
                            CASE WHEN ss.shift_end::time <= ss.shift_start::time
                                THEN ss.shift_end::time + INTERVAL '1 day'
                                ELSE ss.shift_end::time END - ss.shift_start::time
                        )) / 60)::int
                    ELSE 0
                END AS capacity_minutes
         FROM owner_staff os
         CROSS JOIN calendar
         LEFT JOIN staff_schedule ss
           ON ss.staff_id = os.staff_id
          AND LEFT(ss.date::text, 10) = calendar.day::text
         LEFT JOIN hr_shifts hs
           ON hs.staff_id = os.staff_id
          AND hs.shift_date = calendar.day
         LEFT JOIN LATERAL (
            SELECT SUM(GREATEST(0, EXTRACT(EPOCH FROM (
                CASE WHEN segment.planned_end <= segment.planned_start
                    THEN segment.planned_end + INTERVAL '1 day'
                    ELSE segment.planned_end END - segment.planned_start
            )) / 60 - COALESCE(segment.break_minutes, 0)))::int AS minutes
            FROM hr_shift_segments segment
            WHERE segment.hr_shift_id = hs.id
         ) segment_minutes ON true
         ORDER BY os.owner_user_id, calendar.day`,
        [ownerIds, range.from, range.to]
    );
    return result.rows.map(row => ({
        ownerUserId: Number(row.owner_user_id),
        date: row.date,
        status: row.status === 'available' ? 'available' : 'unavailable',
        capacityMinutes: row.capacity_minutes === null || row.capacity_minutes === undefined
            ? null
            : Math.max(0, Number(row.capacity_minutes) || 0)
    }));
}

module.exports = {
    MAX_PLANNING_DAYS,
    loadTaskOwnerCapacity,
    normalizeTaskPlanningRange,
    ownerUserIds
};
