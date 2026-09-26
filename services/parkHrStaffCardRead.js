'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { hasCurrentParkScheduleMembership, parkStaffScheduleRoutePath } = require('./parkStaffScheduleAccess');

const DETAIL_PATH = /^\/staff\/[1-9]\d*$/;
const LIST_FIELDS = [
    'id', 'name', 'department', 'position', 'phone', 'role_type', 'secondary_professions',
    'is_active', 'is_freelance', 'hr_pool_status', 'termination_date', 'photo_url', 'color',
    'company_structure_node_id', 'display_group', 'display_group_label', 'display_groups',
    'display_subgroup', 'display_subgroup_label',
    'has_account', 'has_face_descriptor'
];
const DETAIL_FIELDS = [
    'id', 'name', 'department', 'position', 'phone', 'emergency_contact', 'emergency_phone',
    'role_type', 'secondary_professions', 'hire_date', 'birth_date', 'address', 'is_active',
    'company_structure_node_id', 'photo_url', 'notes', 'telegram_id', 'telegram_username',
    'color', 'contract_type', 'skills', 'hr_pool_status', 'blacklist_reason', 'blacklisted_at',
    'termination_date', 'termination_reason', 'termination_recorded_at', 'termination_recorded_by'
];
const PAYROLL_FIELDS = ['hourly_rate', 'rate_unit', 'profession_rates'];

function pick(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}

function isParkHrStaffCardRoute(req) {
    const path = parkStaffScheduleRoutePath(req);
    return req.method === 'GET' && (path === '/staff' || DETAIL_PATH.test(path));
}

function canReadParkHrStaffCard(req) {
    return isParkHrStaffCardRoute(req) && hasCurrentParkScheduleMembership(req)
        && resolveCapability(req.user, 'hr.staff.view', { type: 'action' }).allowed;
}

function projectParkHrStaffCardPayload(path, payload, { includePayroll = false } = {}) {
    if (payload?.success !== true) return payload;
    if (path === '/staff') {
        return { success: true, data: Array.isArray(payload.data)
            ? payload.data.map(row => {
                const projected = pick(row, LIST_FIELDS);
                if (Array.isArray(row?.schedule_category_memberships)) {
                    projected.schedule_category_memberships = row.schedule_category_memberships.map(item =>
                        pick(item, ['professionKey', 'displayGroup', 'displayGroupLabel', 'subgroupKey', 'subgroupLabel', 'source']));
                }
                if (row?.training_readiness) projected.training_readiness = pick(row.training_readiness,
                    ['total', 'completed', 'percent']);
                return projected;
            }) : [] };
    }
    if (DETAIL_PATH.test(path)) {
        const fields = includePayroll ? [...DETAIL_FIELDS, ...PAYROLL_FIELDS] : DETAIL_FIELDS;
        const projected = pick(payload.data, fields);
        if (includePayroll && Object.hasOwn(projected, 'profession_rates')) {
            projected.profession_rates = Array.isArray(projected.profession_rates)
                ? projected.profession_rates.map(rate => pick(rate, ['profession_key', 'hourly_rate'])) : [];
        }
        return { success: true, data: projected };
    }
    return payload;
}

module.exports = { isParkHrStaffCardRoute, canReadParkHrStaffCard, projectParkHrStaffCardPayload };
