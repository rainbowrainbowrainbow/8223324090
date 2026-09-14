'use strict';

const { BUSINESS_SCOPE_SINGLE, DEFAULT_BUSINESS_CONTEXT, resolveBusinessScope } = require('./businessContext');
const { resolveCapability } = require('./accountAccessPolicy');

const STAFF_READ_PATHS = new Set(['/', '/departments', '/display-groups', '/schedule', '/schedule/hours', '/attendance']);
const STAFF_HISTORY_PATH = /^\/schedule\/history\/[1-9]\d*\/\d{4}-\d{2}-\d{2}$/;

function parkStaffScheduleRoutePath(req) {
    return String(req.path || '/').replace(/\/$/, '') || '/';
}

// Owner confirmed on 2026-09-14 that the existing staff and schedule namespace
// belongs exclusively to Park. This is a read-only recovery, not HR/payroll
// module activation or permission to create another business's staff here.
function canReadParkStaffSchedule(req, routerId) {
    if (req.method !== 'GET') return false;
    const path = parkStaffScheduleRoutePath(req);
    const routeAllowed = routerId === 'staff'
        ? STAFF_READ_PATHS.has(path) || STAFF_HISTORY_PATH.test(path)
        : routerId === 'hr' && path === '/professions';
    if (!routeAllowed || !req.user) return false;

    const scope = resolveBusinessScope(req);
    const access = req.user.businessMembershipAccess;
    if (scope.invalid || scope.mode !== BUSINESS_SCOPE_SINGLE || scope.activeContext !== DEFAULT_BUSINESS_CONTEXT
        || !access || access.invalid || access.membershipEnabled !== true) return false;

    const registry = access.registry?.filter(item => item.businessContext === DEFAULT_BUSINESS_CONTEXT) || [];
    const memberships = access.memberships?.filter(item => item.businessContext === DEFAULT_BUSINESS_CONTEXT) || [];
    const active = req.user.activeBusinessMembership;
    const resolved = access.activeMembership;
    if (registry.length !== 1 || memberships.length !== 1) return false;
    const business = registry[0];
    if (business.active !== true || business.accessMode !== 'membership'
        || !Number.isInteger(business.businessId) || business.businessId <= 0
        || !Number.isInteger(business.organizationId) || business.organizationId <= 0) return false;
    if (![memberships[0], active, resolved].every(member => member
        && member.businessContext === DEFAULT_BUSINESS_CONTEXT && member.accessMode === 'membership'
        && member.businessId === business.businessId && member.organizationId === business.organizationId)) return false;

    return resolveCapability(req.user, 'hr.schedule.view', { type: 'action' }).allowed;
}

module.exports = { canReadParkStaffSchedule, parkStaffScheduleRoutePath };
