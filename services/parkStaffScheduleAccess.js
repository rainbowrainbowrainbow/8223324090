'use strict';

const { BUSINESS_SCOPE_SINGLE, DEFAULT_BUSINESS_CONTEXT, resolveBusinessScope } = require('./businessContext');
const { resolveCapability } = require('./accountAccessPolicy');

const STAFF_READ_PATHS = new Set(['/', '/departments', '/display-groups', '/schedule', '/schedule/hours', '/attendance']);
const STAFF_HISTORY_PATH = /^\/schedule\/history\/[1-9]\d*\/\d{4}-\d{2}-\d{2}$/;
const STAFF_SHIFT_PREFERENCES_PATH = /^\/[1-9]\d*\/shift-preferences$/;
const STAFF_SCHEDULE_REPLACE_PATH = /^\/schedule\/[1-9]\d*\/(?:replace|replacement-clear)$/;

function parkStaffScheduleCapabilities(req, routerId) {
    const method = String(req.method || 'GET').toUpperCase();
    const path = parkStaffScheduleRoutePath(req);
    if (routerId === 'hr') {
        if (method !== 'GET') return null;
        if (path === '/today') return ['hr.today.view'];
        if (path === '/professions') return ['hr.schedule.view'];
        return null;
    }
    if (routerId !== 'staff') return null;
    if (method === 'GET') {
        if (STAFF_READ_PATHS.has(path) || STAFF_HISTORY_PATH.test(path) || STAFF_SHIFT_PREFERENCES_PATH.test(path)) {
            return ['hr.schedule.view'];
        }
        return null;
    }
    if (method === 'POST' && path === '/schedule/export-xlsx') return ['hr.schedule.view', 'export_data'];
    if (method === 'PUT' && (path === '/schedule' || STAFF_SHIFT_PREFERENCES_PATH.test(path))) {
        return ['hr.schedule.manage'];
    }
    if (method === 'POST' && (path === '/schedule/bulk' || path === '/schedule/copy-week'
        || STAFF_SCHEDULE_REPLACE_PATH.test(path))) {
        return ['hr.schedule.manage'];
    }
    return null;
}

function parkStaffScheduleRoutePath(req) {
    return String(req.path || '/').replace(/\/$/, '') || '/';
}

// Owner confirmed on 2026-09-14 that the existing staff and schedule namespace
// belongs exclusively to Park. The bounded lane below supports only the existing
// schedule handlers; it never enables another business's staff or unrelated HR.
function hasCurrentParkScheduleMembership(req) {
    if (!req?.user) return false;
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

    return true;
}

function canUseParkStaffSchedule(req, routerId) {
    const capabilities = parkStaffScheduleCapabilities(req, routerId);
    if (!capabilities || !hasCurrentParkScheduleMembership(req)) return false;
    const method = String(req.method || 'GET').toUpperCase();
    const scope = resolveBusinessScope(req);
    if (!['GET', 'HEAD'].includes(method) && scope.canWrite === false) return false;
    return capabilities.every(capability => resolveCapability(req.user, capability, { type: 'action' }).allowed);
}

function canReadParkStaffSchedule(req, routerId) {
    if (String(req.method || 'GET').toUpperCase() !== 'GET') return false;
    return canUseParkStaffSchedule(req, routerId);
}

module.exports = {
    canReadParkStaffSchedule,
    canUseParkStaffSchedule,
    hasCurrentParkScheduleMembership,
    parkStaffScheduleRoutePath
};
