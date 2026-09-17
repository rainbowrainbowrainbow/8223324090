'use strict';

// Only the explicitly authorized Park schedule recovery lane uses these views.
// Keep compensation, account details and unrelated HR records outside that lane.
const DISPLAY_FIELDS = [
    'display_group', 'display_group_label', 'display_groups', 'display_subgroup', 'display_subgroup_label',
    'displayGroup', 'displayGroupLabel', 'displayGroups', 'displaySubgroup', 'displaySubgroupLabel'
];
const ROSTER_FIELDS = [
    'id', 'name', 'display_name', 'department', 'position', 'role', 'role_type', 'secondary_professions',
    'professions', 'company_structure_node_id', 'photo_url', 'color', 'is_active', 'is_freelance',
    'hr_pool_status', 'termination_date', 'has_account', 'has_face_descriptor', 'card_source', ...DISPLAY_FIELDS
];
const SCHEDULE_FIELDS = [
    'id', 'staff_id', 'date', 'status', 'shift_start', 'shift_end', 'note', 'profession_key', 'break_minutes',
    'name', 'department', 'position', 'color', 'is_active', 'role_type', 'secondary_professions',
    'company_structure_node_id', 'hr_shift_id', 'original_staff_id', 'original_staff_name',
    'replacement_reason', 'replaced_by', 'replaced_at', 'created_at', 'updated_at',
    'primaryProfessionKey', 'primary_profession_key', 'professionKeys', 'profession_keys',
    'plannedMinutes', 'planned_minutes', 'gapMinutes', 'planUpdatedAt', 'plan_updated_at',
    'hrShiftUpdatedAt', 'hr_shift_updated_at', ...DISPLAY_FIELDS
];
const SEGMENT_FIELDS = [
    'id', 'professionKey', 'profession_key', 'shiftStart', 'shift_start', 'shiftEnd', 'shift_end',
    'breakMinutes', 'break_minutes', 'note', 'additionalProfessionKeys', 'additional_profession_keys',
    'paidAdditionalProfessionKeys', 'paid_additional_profession_keys', 'countsAsPhysicalTime', 'physicalTimeSource'
];
const ROLE_IDENTITY_FIELDS = ['professionKey', 'profession_key', 'compensationMode', 'compensation_mode',
    'policyVersion', 'policy_version', 'countsAsPhysicalTime'];
const ROLE_FIELDS = [...ROLE_IDENTITY_FIELDS,
    'payMultiplier', 'pay_multiplier', 'intervalStart', 'interval_start', 'intervalEnd', 'interval_end',
];
const ATTENDANCE_FIELDS = [
    'staff_id', 'date', 'time_record_id', 'clock_in', 'clock_out', 'planned_start', 'planned_end',
    'late_minutes', 'early_leave_minutes', 'overtime_minutes', 'total_worked_minutes', 'time_status',
    'status', 'auto_closed', 'checkin_id', 'checkin_at', 'checkout_at', 'checkin_method', 'attendance_source',
    'plannedMinutes', 'planned_minutes', 'actualMinutes', 'actual_minutes', 'allocatedMinutes', 'allocated_minutes',
    'allocationOvertimeMinutes', 'allocation_overtime_minutes', 'unallocatedGapMinutes', 'unallocated_gap_minutes',
    'overtimeMinutes', 'allocationSource', 'allocation_source', 'breakPolicy', 'break_policy',
    'is_late', 'is_early_leave', 'has_overtime', 'plan_source', 'plan_warning'
];
const ALLOCATION_FIELDS = [
    'segmentId', 'segment_id', 'segmentIndex', 'professionKey', 'profession_key',
    'shiftStart', 'shift_start', 'shiftEnd', 'shift_end', 'breakMinutes', 'break_minutes',
    'plannedMinutes', 'planned_minutes', 'actualMinutes', 'actual_minutes', 'overtimeMinutes', 'overtime_minutes',
    'overlapMinutes', 'breakDeductedMinutes', 'countsAsPhysicalTime'
];
const HISTORY_VALUE_FIELDS = [
    'staffId', 'date', 'status', 'shiftStart', 'shiftEnd', 'note', 'professionKey', 'originalStaffId',
    'replacementReason', 'primaryProfessionKey', 'plannedStart', 'plannedEnd', 'plannedMinutes', 'gapMinutes'
];
const HISTORY_CHANGE_FIELDS = [
    ...HISTORY_VALUE_FIELDS, 'segments', 'dayPlan', 'segmentTimes', 'segmentProfessions',
    'segmentAdditionalRoles', 'segmentBreaks'
];
const SHIFT_PREFERENCE_FIELDS = [
    'id', 'staff_id', 'staffId', 'profession_key', 'professionKey', 'day_type', 'dayType',
    'start_time', 'startTime', 'end_time', 'endTime', 'is_active', 'isActive',
    'created_at', 'createdAt', 'updated_at', 'updatedAt'
];

function pick(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}

function mapRows(rows, project) {
    return Array.isArray(rows) ? rows.map(project) : [];
}

function projectDisplayMemberships(row, projected) {
    for (const key of ['schedule_category_memberships', 'scheduleCategoryMemberships']) {
        if (Object.hasOwn(row, key)) projected[key] = mapRows(row[key], item => pick(item,
            ['professionKey', 'displayGroup', 'displayGroupLabel', 'subgroupKey', 'subgroupLabel', 'source']));
    }
    return projected;
}

function projectRoster(row) {
    const projected = projectDisplayMemberships(row, pick(row, ROSTER_FIELDS));
    for (const key of ['training_readiness', 'trainingReadiness']) {
        if (Object.hasOwn(row, key)) projected[key] = pick(row[key], ['total', 'completed', 'percent']);
    }
    return projected;
}

function projectSegment(segment, { includePaidRolePlanning = false } = {}) {
    const projected = pick(segment, SEGMENT_FIELDS);
    for (const key of ['additionalRoles', 'additional_roles']) {
        if (Object.hasOwn(segment, key)) projected[key] = mapRows(segment[key], role => pick(role,
            includePaidRolePlanning ? ROLE_FIELDS : ROLE_IDENTITY_FIELDS));
    }
    return projected;
}

function projectSchedule(row) {
    const projected = projectDisplayMemberships(row, pick(row, SCHEDULE_FIELDS));
    if (Object.hasOwn(row, 'segments')) projected.segments = mapRows(row.segments,
        segment => projectSegment(segment, { includePaidRolePlanning: true }));
    return projected;
}

function projectAttendance(row) {
    const projected = pick(row, ATTENDANCE_FIELDS);
    for (const key of ['segmentAllocations', 'segment_allocations']) {
        if (Object.hasOwn(row, key)) projected[key] = mapRows(row[key], item => pick(item, ALLOCATION_FIELDS));
    }
    for (const key of ['allocationIssues', 'allocation_issues']) {
        if (Object.hasOwn(row, key)) projected[key] = mapRows(row[key], item => pick(item, ['code', 'message', 'segmentIndex']));
    }
    if (Object.hasOwn(row, 'attendance_facts')) projected.attendance_facts = pick(row.attendance_facts,
        ['isLate', 'isEarlyLeave', 'hasOvertime', 'lateMinutes', 'earlyLeaveMinutes', 'overtimeMinutes']);
    return projected;
}

function projectToday(row) {
    const projected = pick(row, ['staff_id', 'staff_name', 'department', 'company_structure_node_id',
        'position', 'staff_color', 'role_type', 'photo_url', 'has_photo', 'is_birthday_today', ...DISPLAY_FIELDS]);
    projected.shift = row.shift ? pick(row.shift, ['planned_start', 'planned_end', 'shift_type',
        'primary_profession_key', 'planned_minutes']) : null;
    if (projected.shift && Object.hasOwn(row.shift, 'segments')) {
        projected.shift.segments = mapRows(row.shift.segments, projectSegment);
    }
    projected.record = row.record ? { ...pick(row.record, ['id']), ...projectAttendance(row.record) } : null;
    if (projected.record && Object.hasOwn(row.record, 'plan_warning')) {
        projected.record.plan_warning = row.record.plan_warning
            ? pick(row.record.plan_warning, ['code', 'message']) : null;
    }
    return projected;
}

function hasExplicitHourlyRate(person) {
    const explicitRate = Number(person?.explicitRate);
    return person?.isActive !== false
        && person?.assignmentStatus === 'active'
        && person?.admissionStatus === 'approved'
        && person?.rateUnit === 'hour'
        && person?.rateSource === 'staff_profession_rates.hourly_rate'
        && Number.isFinite(explicitRate)
        && explicitRate > 0;
}

function projectProfessionCatalogRow(row, { includePayroll = false } = {}) {
    const projected = pick(row, ['id', 'key', 'title', 'department', 'color', 'is_active', 'structure_node_id', 'sort_order']);
    if (!Array.isArray(row?.people)) return projected;
    projected.people = mapRows(row.people, person => ({
        ...pick(person, ['id', 'isActive', 'isPrimary', 'assignmentStatus', 'admissionStatus', 'internshipStatus']),
        hasExplicitHourlyRate: hasExplicitHourlyRate(person),
        ...(includePayroll ? pick(person, ['explicitRate', 'rateUnit', 'rateSource']) : {})
    }));
    return projected;
}

function projectHistoryValue(field, value) {
    if (value === null || value === undefined) return value;
    if (field === 'segments') return mapRows(value, projectSegment);
    if (field === 'dayPlan') {
        const projected = pick(value, HISTORY_VALUE_FIELDS);
        if (Object.hasOwn(value, 'segments')) projected.segments = mapRows(value.segments, projectSegment);
        return projected;
    }
    if (field === 'segmentTimes') return mapRows(value, item => pick(item, ['shiftStart', 'shiftEnd']));
    if (Array.isArray(value)) return value.map(item => Array.isArray(item)
        ? item.filter(part => typeof part === 'string' || typeof part === 'number')
        : item).filter(item => Array.isArray(item) || typeof item === 'string' || typeof item === 'number');
    return typeof value === 'object' ? null : value;
}

function projectHistory(row) {
    const projected = pick(row, ['id', 'action', 'staff_id', 'performed_by', 'created_at']);
    let details = row.details;
    if (typeof details === 'string') {
        try { details = JSON.parse(details); } catch { details = {}; }
    }
    projected.details = pick(details, ['source', 'date', 'staffId', 'outcome', 'code']);
    for (const key of ['before', 'after']) {
        if (details && Object.hasOwn(details, key)) projected.details[key] = pick(details[key], HISTORY_VALUE_FIELDS);
    }
    projected.details.changes = Object.fromEntries(HISTORY_CHANGE_FIELDS
        .filter(field => details?.changes && Object.hasOwn(details.changes, field))
        .map(field => [field, Object.fromEntries(['from', 'to']
            .filter(key => Object.hasOwn(details.changes[field] || {}, key))
            .map(key => [key, projectHistoryValue(field, details.changes[field][key])]))]));
    return projected;
}

function projectParkStaffSchedulePayload(routerId, routePath, payload, options = {}) {
    // Preserve existing validation/permission/server errors; they contain no read data.
    if (!payload || payload.success !== true) return payload;
    const path = String(routePath || '/').replace(/\/+$/, '') || '/';
    if (routerId === 'hr' && path === '/professions') {
        return {
            success: true,
            data: mapRows(payload.data, row => projectProfessionCatalogRow(row, options)),
            professionCatalogAccess: {
                readOnly: true,
                partial: true,
                businessContext: 'event_genix',
                reason: 'park_schedule_recovery_projection',
                payrollDataAccess: options.includePayroll === true,
                unsupportedFields: ['staffCount', 'checklist', 'checklistCount', 'workspace']
            }
        };
    }
    if (routerId === 'hr' && path === '/today') {
        return { ...pick(payload, ['success', 'date', 'displayGroups']), data: mapRows(payload.data, projectToday),
            summary: pick(payload.summary, ['total_staff', 'present', 'late', 'absent', 'on_vacation', 'sick']) };
    }
    if (routerId !== 'staff') throw new TypeError('Unknown Park schedule projection route');
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'GET') {
        if (method === 'PUT' && path === '/schedule') {
            return { success: true, data: projectSchedule(payload.data) };
        }
        if (method === 'POST' && /^\/schedule\/[1-9]\d*\/(?:replace|replacement-clear)$/.test(path)) {
            return { success: true, data: projectSchedule(payload.data) };
        }
        if (method === 'POST' && path === '/schedule/bulk') {
            return pick(payload, ['success', 'count']);
        }
        if (method === 'POST' && path === '/schedule/copy-week') {
            return pick(payload, ['success', 'count', 'conflicts', 'staffCount', 'copyMode', 'department', 'displayGroup', 'dryRun']);
        }
        if (method === 'PUT' && /^\/[1-9]\d*\/shift-preferences$/.test(path)) {
            return {
                ...pick(payload, ['success', 'staffId', 'allowedProfessions', 'count', 'ensuredFallbackCount']),
                data: mapRows(payload.data, row => pick(row, SHIFT_PREFERENCE_FIELDS))
            };
        }
        throw new TypeError('Unknown Park schedule mutation projection route');
    }
    const projected = pick(payload, ['success', 'departments', 'displayGroups', 'displayGroupOptions',
        'scheduleCategoryContract', 'from', 'to', 'summary', 'source']);
    if (path === '/') projected.data = mapRows(payload.data, projectRoster);
    else if (path === '/schedule') projected.data = mapRows(payload.data, projectSchedule);
    else if (path === '/attendance') projected.data = mapRows(payload.data, projectAttendance);
    else if (/^\/schedule\/history\/\d+\/\d{4}-\d{2}-\d{2}$/.test(path)) projected.data = mapRows(payload.data, projectHistory);
    else if (/^\/[1-9]\d*\/shift-preferences$/.test(path)) {
        return {
            ...pick(payload, ['success', 'staffId', 'allowedProfessions', 'count', 'ensuredFallbackCount']),
            data: mapRows(payload.data, row => pick(row, SHIFT_PREFERENCE_FIELDS))
        };
    }
    else if (path === '/schedule/hours') projected.data = Object.fromEntries(Object.entries(payload.data || {})
        .map(([staffId, row]) => [staffId, pick(row, ['name', 'department', 'position', 'totalHours',
            'workingDays', 'dayoffs', 'vacationDays', 'sickDays', 'remoteDays'])]));
    else if (path === '/departments' || path === '/display-groups') projected.data = payload.data;
    else throw new TypeError('Unknown Park schedule projection route');
    return projected;
}

module.exports = { projectParkStaffSchedulePayload };
