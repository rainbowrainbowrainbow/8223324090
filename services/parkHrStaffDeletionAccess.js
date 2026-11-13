'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { resolveBusinessScope } = require('./businessContext');
const { hasCurrentParkScheduleMembership, parkStaffScheduleRoutePath } = require('./parkStaffScheduleAccess');

function isParkHrStaffDeletionRoute(req) {
    const path = parkStaffScheduleRoutePath(req);
    const match = req.method === 'GET' ? /^\/staff\/([1-9]\d*)\/delete-readiness$/.exec(path)
        : req.method === 'DELETE' ? /^\/staff\/([1-9]\d*)$/.exec(path) : null;
    return Boolean(match && Number.isSafeInteger(Number(match[1])));
}

function canDeleteParkHrStaff(req) {
    return isParkHrStaffDeletionRoute(req) && hasCurrentParkScheduleMembership(req)
        && resolveBusinessScope(req).canWrite === true
        && resolveCapability(req.user, 'hr.staff.manage', { type: 'action' }).allowed;
}

// Readiness and a blocked DELETE share the same payload. Presence/counts explain
// why deletion is blocked; payroll amounts require their separate capability.
function projectStaffDeletionReadiness(data, user) {
    if (!data || resolveCapability(user, 'hr.payroll.view', { type: 'action' }).allowed) return data;
    return { ...data, blockers: data.blockers.map(({ amount, ...blocker }) => blocker) };
}

module.exports = { isParkHrStaffDeletionRoute, canDeleteParkHrStaff, projectStaffDeletionReadiness };
