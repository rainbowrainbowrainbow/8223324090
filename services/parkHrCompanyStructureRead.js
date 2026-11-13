'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { hasCurrentParkScheduleMembership } = require('./parkStaffScheduleAccess');

const NODE_FIELDS = [
    'id', 'title', 'parentId', 'lane', 'tone', 'stack', 'order',
    'x', 'y', 'displayGroup', 'archived', 'collapsed'
];
const DISPLAY_GROUP_FIELDS = ['key', 'label', 'order'];

function pick(source, fields) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    return Object.fromEntries(fields.filter(field => Object.hasOwn(source, field))
        .map(field => [field, source[field]]));
}

function isParkHrCompanyStructureRoute(req) {
    return req.method === 'GET' && req.path === '/company-structure';
}

function canReadParkHrCompanyStructure(req) {
    return isParkHrCompanyStructureRoute(req) && hasCurrentParkScheduleMembership(req)
        && resolveCapability(req.user, 'hr.staff.view', { type: 'action' }).allowed;
}

function projectParkHrCompanyStructurePayload(payload, canWrite = false) {
    if (payload?.success !== true) return payload;
    const nodes = Array.isArray(payload.data?.nodes)
        ? payload.data.nodes.map(node => pick(node, canWrite ? [...NODE_FIELDS, 'description', 'meta'] : NODE_FIELDS)) : [];
    return {
        success: true,
        data: { nodes, ...(canWrite ? pick(payload.data, ['structure', 'instructions', 'updatedAt']) : {}) },
        hasSavedStructure: payload.hasSavedStructure === true,
        displayGroups: Array.isArray(payload.displayGroups)
            ? payload.displayGroups.map(group => pick(group, DISPLAY_GROUP_FIELDS)) : [],
        structureAccess: { readOnly: !canWrite, businessContext: 'event_genix' }
    };
}

module.exports = {
    isParkHrCompanyStructureRoute,
    canReadParkHrCompanyStructure,
    projectParkHrCompanyStructurePayload
};
