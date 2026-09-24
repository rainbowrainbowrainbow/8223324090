'use strict';

const { BUSINESS_SCOPE_SINGLE, DEFAULT_BUSINESS_CONTEXT, resolveBusinessScope } = require('./businessContext');
const { resolveCapability } = require('./accountAccessPolicy');

const SURFACE_PAGES = Object.freeze({ certificates: ['/certificates', '/certificates/new', '/certificates/batch', '/certificates/check'], art: ['/art'] });

// The authorized recovery keeps these existing namespaces exclusive to Park.
// Fresh server-resolved membership identity remains mandatory; it never enables
// another business or changes the configured module registry or route roles.
function hasCurrentParkMembership(user, context) {
    const access = user?.businessMembershipAccess;
    if (context !== DEFAULT_BUSINESS_CONTEXT || !access || access.invalid || access.membershipEnabled !== true) return false;
    const registry = access.registry?.filter(item => item.businessContext === context) || [];
    const memberships = access.memberships?.filter(item => item.businessContext === context) || [];
    if (registry.length !== 1 || memberships.length !== 1) return false;
    const business = registry[0];
    if (business.active !== true || business.accessMode !== 'membership'
        || !Number.isInteger(business.businessId) || business.businessId <= 0
        || !Number.isInteger(business.organizationId) || business.organizationId <= 0) return false;
    return [memberships[0], user.activeBusinessMembership, access.activeMembership].every(member => member
        && member.businessContext === context && member.accessMode === 'membership'
        && member.businessId === business.businessId && member.organizationId === business.organizationId);
}

function parkLegacySurfaceAvailability(user, context) {
    const member = hasCurrentParkMembership(user, context);
    return Object.fromEntries(Object.entries(SURFACE_PAGES).map(([surface, pages]) => {
        const available = member && pages.some(page => resolveCapability(user, page, { type: 'page' }).allowed);
        return [surface, { available, code: available ? null : `${surface}_not_migrated` }];
    }));
}

function canUseParkLegacySurface(req, surface, scope = resolveBusinessScope(req)) {
    if (!Object.hasOwn(SURFACE_PAGES, surface) || scope.invalid || scope.mode !== BUSINESS_SCOPE_SINGLE
        || !hasCurrentParkMembership(req.user, scope.activeContext)) return false;
    const method = String(req.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
    if (!['GET', 'HEAD'].includes(method) && scope.canWrite === false) return false;
    const path = String(req.path || '/').toLowerCase().replace(/\/$/, '') || '/';
    const page = surface === 'art' ? '/art'
        : method === 'POST' && path === '/' ? '/certificates/new'
            : method === 'POST' && path === '/batch' ? '/certificates/batch'
                : (['GET', 'HEAD'].includes(method) && path.startsWith('/code/'))
                    || (method === 'POST' && /^\/\d+\/redeem$/.test(path)) ? '/certificates/check'
                    : '/certificates';
    return resolveCapability(req.user, page, { type: 'page' }).allowed;
}

module.exports = { hasCurrentParkMembership, parkLegacySurfaceAvailability, canUseParkLegacySurface };
