'use strict';

const { applyMembershipAccess, loadMembershipAccess } = require('./businessMembership');
const { resolveBusinessScope } = require('./businessContext');

function requestedAuthBusinessContext(request = {}) {
    const values = [request.body?.businessContext, request.body?.business_context,
        request.query?.businessContext, request.query?.business_context,
        request.headers?.['x-business-context']];
    const value = values.find(item => item !== undefined && item !== null);
    return { explicit: value !== undefined, value: value ?? null };
}

function authAccessContext(scope = {}) {
    return {
        status: !scope.invalid ? 'ready'
            : scope.reason === 'business_context_required' ? 'selection_required' : 'unavailable',
        code: scope.invalid ? scope.reason || 'business_context_unavailable' : null
    };
}

async function resolveAuthBusinessContext(db, user, request = {}, options = {}) {
    const requested = requestedAuthBusinessContext(request);
    let access = options.membershipAccess || await loadMembershipAccess(db, user, requested.value);
    if (requested.explicit && (typeof requested.value !== 'string' || !requested.value.trim())) {
        access = { ...access, invalid: true, reason: 'business_context_unavailable' };
    }
    let scopedUser = applyMembershipAccess(user, access);
    const scope = resolveBusinessScope({ ...request, user: scopedUser });
    if (scope.invalid && !access.invalid) {
        access = { ...access, invalid: true, reason: scope.reason };
        scopedUser = applyMembershipAccess(user, access);
    }
    return { user: scopedUser, scope, accessContext: authAccessContext(scope), explicitContext: requested.explicit };
}

function authBusinessUserFields(user, scope) {
    const ready = !scope.invalid;
    return {
        platformRole: user.platformRole || null,
        organizationId: ready ? user.organizationId || null : null,
        organizationRole: ready ? user.organizationRole || null : null,
        activeBusinessContext: ready ? scope.activeContext || null : null,
        activeBusinessMembership: ready ? user.businessMembershipAccess?.activeMembership || null : null,
        membershipConfigured: user.businessMembershipAccess?.configured === true,
        membershipMode: user.businessMembershipAccess?.membershipEnabled === true ? 'membership' : 'compatibility',
        accessContext: authAccessContext(scope)
    };
}

module.exports = { authAccessContext, authBusinessUserFields, requestedAuthBusinessContext, resolveAuthBusinessContext };
