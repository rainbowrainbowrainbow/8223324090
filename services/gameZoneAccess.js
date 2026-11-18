'use strict';
const { resolveCapability, normalizeRoleList } = require('./accountAccessPolicy');
const { timelineContextFromRequest, canViewTimelinePage } = require('./timelineContext');
const { hasCurrentParkMembership } = require('./parkLegacyModuleAccess');

function hasGameZoneTimelineScope(user, context) {
    return context === 'event_genix' && hasCurrentParkMembership(user, context)
        && resolveCapability(user, 'timeline.game_zones.view').allowed && canViewTimelinePage(user, context);
}

async function loadGameZoneResourceIds(db, user, context) {
    if (!hasGameZoneTimelineScope(user, context)) return [];
    const result = await db.query(`SELECT resource_id FROM timeline_resources
        WHERE business_context = $1 AND type = 'room' AND is_active IS TRUE
          AND metadata->>'workArea' = 'game_zone' ORDER BY resource_id`, [context]);
    return result.rows.map(row => row.resource_id);
}

function usesGameZoneResourceView(user, context) {
    if (context !== 'event_genix') return false;
    const broad = resolveCapability(user, 'view_all');
    if (broad.allowed || (normalizeRoleList(user).includes('animator') && broad.source !== 'explicit_deny')) return false;
    const zones = resolveCapability(user, 'timeline.game_zones.view');
    return zones.allowed || zones.source === 'explicit_deny';
}

function filterGameZoneResources(user, context, resources) {
    if (!usesGameZoneResourceView(user, context)) return resources;
    if (!hasGameZoneTimelineScope(user, context)) return [];
    return resources.filter(resource => resource.businessContext === context && resource.type === 'room'
        && resource.isActive === true && resource.metadata?.workArea === 'game_zone');
}

async function loadGameZoneAccess(req, res, next) {
    try {
        req.user.gameZoneResourceIds = [];
        const context = timelineContextFromRequest(req);
        if (!hasGameZoneTimelineScope(req.user, context)) return next();
        req.user.gameZoneResourceIds = await loadGameZoneResourceIds(require('../db').pool, req.user, context);
        return next();
    } catch (error) { return next(error); }
}
module.exports = { hasGameZoneTimelineScope, loadGameZoneResourceIds, loadGameZoneAccess,
    usesGameZoneResourceView, filterGameZoneResources };
