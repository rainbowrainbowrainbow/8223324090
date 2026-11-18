'use strict';

const { resolveCapability } = require('./accountAccessPolicy');

const PUBLIC_COORDINATION_FIELDS = new Set([
    'id', 'staff_id', 'staffId', 'name', 'display_name', 'department', 'position', 'role', 'role_type',
    'color', 'is_active', 'is_freelance', 'date', 'shift_start', 'shift_end', 'status', 'profession_key',
    'hr_shift_id', 'hr_profession_key', 'hr_planned_start', 'hr_planned_end', 'hr_break_minutes',
    'hr_shift_type', 'updated_at', 'hr_shift_updated_at', 'hr_plan_updated_at', 'plannedMinutes',
    'display_group', 'display_group_label', 'display_groups', 'display_subgroup', 'display_subgroup_label',
    'displayGroup', 'displayGroupLabel', 'displayGroups', 'displaySubgroup', 'displaySubgroupLabel',
    'schedule_category_memberships', 'scheduleCategoryMemberships', 'secondary_professions', 'professions',
    'totalHours', 'workingDays', 'dayoffs', 'remoteDays', 'segments',
    'primaryProfessionKey', 'primary_profession_key', 'professionKeys', 'profession_keys',
    'planned_minutes', 'gapMinutes', 'planUpdatedAt', 'plan_updated_at', 'hrShiftUpdatedAt'
]);
const SEGMENT_COORDINATION_FIELDS = new Set(['id', 'professionKey', 'profession_key', 'workMode', 'work_mode',
    'shiftStart', 'shift_start', 'shiftEnd', 'shift_end', 'startDayOffset', 'endDayOffset',
    'breakMinutes', 'break_minutes', 'additionalProfessionKeys', 'additional_profession_keys']);

function shapeCoordinationRow(row) {
    if (!row || typeof row !== 'object') return row;
    const shaped = Object.fromEntries(Object.entries(row).filter(([key]) => PUBLIC_COORDINATION_FIELDS.has(key)));
    if (Array.isArray(shaped.segments)) shaped.segments = shaped.segments.map(segment =>
        Object.fromEntries(Object.entries(segment).filter(([key]) => SEGMENT_COORDINATION_FIELDS.has(key))));
    for (const key of ['status', 'hr_shift_type']) {
        if (shaped[key] && !['working', 'remote', 'work', 'dayoff', 'day_off', 'unset'].includes(shaped[key])) shaped[key] = 'dayoff';
    }
    if ('sickDays' in row || 'vacationDays' in row) {
        shaped.dayoffs = Number(shaped.dayoffs || 0) + Number(row.sickDays || 0) + Number(row.vacationDays || 0);
    }
    return shaped;
}

function installStaffScheduleFieldAccess(req, res, next) {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    if (resolveCapability(req.user, 'hr.staff.view').allowed) return next();
    const path = String(req.path || '/').replace(/\/$/, '') || '/';
    // Audit history is a personnel record, not a team coordination field.
    if (path.startsWith('/schedule/history/')) return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    if (!['/', '/schedule', '/schedule/hours'].includes(path)) return next();
    const json = res.json.bind(res);
    res.json = payload => {
        if (!payload?.data) return json(payload);
        const data = Array.isArray(payload.data) ? payload.data.map(shapeCoordinationRow)
            : Object.fromEntries(Object.entries(payload.data).map(([id, row]) => [id, shapeCoordinationRow(row)]));
        return json({ ...payload, data });
    };
    return next();
}

module.exports = { shapeCoordinationRow, installStaffScheduleFieldAccess };
