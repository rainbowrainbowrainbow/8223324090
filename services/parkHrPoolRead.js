'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { hasCurrentParkScheduleMembership, parkStaffScheduleRoutePath } = require('./parkStaffScheduleAccess');

const POOL_FIELDS = ['id', 'name', 'department', 'position', 'is_active', 'hr_pool_status'];

function isParkHrPoolRoute(req) {
    return req.method === 'GET' && parkStaffScheduleRoutePath(req) === '/pool';
}

function canReadParkHrPool(req) {
    return isParkHrPoolRoute(req) && hasCurrentParkScheduleMembership(req)
        && resolveCapability(req.user, 'hr.staff.view', { type: 'action' }).allowed;
}

function projectParkHrPoolPayload(payload) {
    if (payload?.success !== true) return payload;
    return {
        success: true,
        status: payload.status,
        data: Array.isArray(payload.data) ? payload.data.map(row => Object.fromEntries(
            POOL_FIELDS.filter(field => Object.hasOwn(row || {}, field)).map(field => [field, row[field]])
        )) : []
    };
}

module.exports = { isParkHrPoolRoute, canReadParkHrPool, projectParkHrPoolPayload };
