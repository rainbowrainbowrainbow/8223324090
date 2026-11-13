'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { resolveStaffOperation } = require('./staffOperationAccess');
const { resolveBusinessScope } = require('./businessContext');
const { hasCurrentParkScheduleMembership, parkStaffScheduleRoutePath } = require('./parkStaffScheduleAccess');

const MANAGE = 'hr.staff.manage';
const staff = '/staff/[0-9]+';
const routes = [
    ['GET', new RegExp(`^${staff}/role-assignments$`, 'i'), MANAGE],
    ['GET', new RegExp(`^${staff}/(?:history|lifecycle-checklist|documents(?:/[0-9]+/(?:preview|download))?|medical-book|resources|offboarding(?:-readiness)?)$`, 'i'), MANAGE],
    ['GET', new RegExp(`^${staff}/shifts$`, 'i'), 'hr.schedule.view'],
    ['GET', /^\/resource-options$/i, MANAGE],
    ['GET', /^\/role-assignments\/report$/i, 'hr.reports.view'],
    ['POST', new RegExp(`^${staff}/(?:documents|medical-book|resources|offboarding)$`, 'i'), MANAGE],
    ['POST', /^\/onboarding\/(?:start|templates)$/i, MANAGE],
    ['PUT', new RegExp(`^${staff}/(?:documents/[0-9]+/restore|resources/[0-9]+/(?:return|status)|status|pool-status|onboarding-assignment|profession-checklist)$`, 'i'), MANAGE],
    ['PUT', /^\/(?:onboarding\/[0-9]+\/check|company-structure)$/i, MANAGE],
    ['PATCH', new RegExp(`^${staff}/medical-book/[0-9]+$`, 'i'), MANAGE],
    ['DELETE', new RegExp(`^${staff}/documents/[0-9]+$`, 'i'), MANAGE]
];

function staffWorkflowCapability(req) {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const path = parkStaffScheduleRoutePath(req);
    return routes.find(([verb, pattern]) => verb === method && pattern.test(path))?.[2];
}

function canUseParkHrStaffWorkflow(req) {
    const capability = staffWorkflowCapability(req);
    const path = parkStaffScheduleRoutePath(req);
    const ids = path.split('/').filter(segment => /^\d+$/.test(segment));
    return Boolean(capability && hasCurrentParkScheduleMembership(req)
        && ids.every(id => /^[1-9]\d*$/.test(id) && Number(id) <= 2147483647)
        && (['GET', 'HEAD'].includes(req.method) || resolveBusinessScope(req).canWrite === true)
        && resolveCapability(req.user, capability, { type: 'action' }).allowed);
}

function staffWorkflowAvailability(req) {
    const canManage = resolveCapability(req.user, MANAGE, { type: 'action' }).allowed;
    return { documents: canManage, move: canManage && resolveBusinessScope(req).canWrite === true
        && resolveStaffOperation(req.user, 'hr.staff.profile.edit') === MANAGE };
}

module.exports = { staffWorkflowCapability, canUseParkHrStaffWorkflow, staffWorkflowAvailability };
