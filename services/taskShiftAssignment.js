'use strict';

const { canReassignTask } = require('./taskPolicy');
const { businessUserAccessSql } = require('./businessUserAccess');
const { STAFF_SCHEDULE_SUBGROUPS, listStaffDisplayGroups, resolveStaffDisplayGroup, staffProfessionCategoryRule } = require('./staffDisplayGroups');
const { canUseParkStaffSchedule } = require('./parkStaffScheduleAccess');
const { legacyBusinessSurfaceAccess } = require('./legacyBusinessSurface');
const { resolveCapability } = require('./accountAccessPolicy');
const { getAssignableTaskOwner, taskPersonLabel } = require('./taskExecution');

function shiftAssignmentError(statusCode, code, message) {
    return Object.assign(new Error(message), { statusCode, code });
}

function normalizeTaskShiftDate(value) {
    const date = typeof value === 'string' ? value : '';
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T00:00:00Z') : null;
    if (!parsed || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
        throw shiftAssignmentError(400, 'TASK_SHIFT_DATE_INVALID', 'Оберіть коректну дату зміни.');
    }
    return date;
}

function normalizeTaskShiftAssignment(value) {
    if (value === undefined) return null;
    const date = normalizeTaskShiftDate(value?.date);
    const group = taskShiftGroups().find(item => item.key === value.group);
    if (!group) throw shiftAssignmentError(400, 'TASK_SHIFT_GROUP_INVALID', 'Оберіть відділ.');
    return { date, group: group.key };
}

function taskShiftGroups() {
    return listStaffDisplayGroups().flatMap(group => [
        group,
        ...(STAFF_SCHEDULE_SUBGROUPS[group.key] || []).map(subgroup => ({
            key: group.key + '.' + subgroup.key,
            label: subgroup.label
        }))
    ]);
}

async function listTaskShiftGroups(db, req, scope, date) {
    const scheduleRequest = { user: req.user, query: { businessContext: scope.activeContext }, headers: req.headers, method: 'GET', path: '/schedule' };
    const scheduleAvailable = canUseParkStaffSchedule(scheduleRequest, 'staff')
        || (legacyBusinessSurfaceAccess(scheduleRequest, 'staff').available
            && resolveCapability(req.user, 'hr.schedule.view', { type: 'action' }).allowed);
    if (!scheduleAvailable || !canReassignTask(req.user)) {
        throw shiftAssignmentError(403, 'TASK_SHIFT_UNAVAILABLE', 'Призначення за графіком недоступне в цьому бізнесі або для цього облікового запису.');
    }
    const params = [date];
    const membership = businessUserAccessSql(req.user, params, 'users', scope);
    const { rows } = await db.query(
        `SELECT s.id AS staff_id, s.department, s.role_type, hs.profession_key,
                segment.profession_key AS segment_profession, segment.role_keys,
                CASE WHEN users.is_active IS DISTINCT FROM FALSE
                      AND users.id IS NOT NULL ${membership.condition}
                     THEN users.id END AS user_id,
                users.name AS user_name, users.username AS user_username
         FROM staff_schedule ss
         JOIN staff s ON s.id = ss.staff_id AND s.is_active IS DISTINCT FROM FALSE
         LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active IS TRUE
         LEFT JOIN users ON users.id = ep.user_id
         LEFT JOIN hr_shifts hs ON hs.staff_id = s.id AND hs.shift_date = ss.date::date
         LEFT JOIN LATERAL (
             SELECT segment.profession_key, ARRAY(
                 SELECT extra.profession_key FROM hr_shift_segment_roles extra WHERE extra.segment_id = segment.id
             ) AS role_keys
             FROM hr_shift_segments segment
             WHERE segment.hr_shift_id = hs.id
               AND ss.date::date + COALESCE(segment.start_day_offset, 0) + segment.planned_start < $1::date + 1
               AND ss.date::date + COALESCE(segment.end_day_offset,
                   CASE WHEN segment.planned_end < segment.planned_start THEN 1 ELSE 0 END) + segment.planned_end > $1::date
         ) segment ON TRUE
         WHERE ss.date::date IN ($1::date, $1::date - 1)
           AND ss.status IN ('working', 'remote')
           AND (
               segment.profession_key IS NOT NULL
               OR (NOT EXISTS (SELECT 1 FROM hr_shift_segments x WHERE x.hr_shift_id = hs.id)
                   AND (ss.date::date = $1::date OR ss.shift_end::time < ss.shift_start::time))
           )
         ORDER BY s.id, users.id`,
        params
    );
    const groups = new Map(taskShiftGroups().map(group => [
        group.key, { key: group.key, label: group.label, staffIds: new Set(), users: new Map(), unavailable: new Set() }
    ]));
    const eligible = new Set();
    for (const userId of new Set(rows.map(row => Number(row.user_id)).filter(Boolean))) {
        try {
            await getAssignableTaskOwner(userId, { pool: db, actor: req.user, businessScope: scope });
            eligible.add(userId);
        } catch (error) {
            if (![400, 403, 404, 422].includes(error.statusCode)) throw error;
        }
    }
    for (const row of rows) {
        const professions = [row.segment_profession || row.profession_key || row.role_type, ...(row.role_keys || [])];
        const keys = professions.flatMap(profession => {
            const rule = staffProfessionCategoryRule(profession);
            const group = rule?.displayGroup || resolveStaffDisplayGroup({ role_type: profession, department: row.department });
            return rule?.subgroupKey ? [group, group + '.' + rule.subgroupKey] : [group];
        });
        for (const key of new Set(keys)) {
            const group = groups.get(key);
            if (!group) continue;
            group.staffIds.add(row.staff_id);
            if (eligible.has(Number(row.user_id))) {
                const id = Number(row.user_id);
                group.users.set(id, { id, label: taskPersonLabel({ id, name: row.user_name, username: row.user_username }) });
            }
            else group.unavailable.add(row.staff_id);
        }
    }
    return [...groups.values()].filter(group => group.staffIds.size > 0).map(group => ({
        key: group.key,
        label: group.label,
        users: [...group.users.values()],
        unavailableCount: group.unavailable.size
    }));
}

module.exports = { listTaskShiftGroups, normalizeTaskShiftAssignment, normalizeTaskShiftDate, shiftAssignmentError };
