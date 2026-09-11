'use strict';

const { normalizeBusinessContext } = require('./businessContext');

const MEMBERSHIP_SCHEMA_MISSING = new Set(['42P01', '42703']);

function isMembershipSchemaMissing(error) {
    return MEMBERSHIP_SCHEMA_MISSING.has(error?.code)
        || /relation .*organizations.* does not exist|relation .*business_memberships.* does not exist/i.test(String(error?.message || ''));
}

function normalizeMembershipRow(row = {}) {
    return {
        organizationId: Number(row.organization_id),
        organizationSlug: row.organization_slug,
        organizationName: row.organization_name,
        organizationRole: row.organization_role,
        businessId: Number(row.business_id),
        businessContext: normalizeBusinessContext(row.context_key),
        businessLabel: row.business_label,
        businessShortLabel: row.business_short_label || row.business_label,
        businessModules: Array.isArray(row.business_modules) ? row.business_modules : [],
        accessMode: row.access_mode,
        role: row.role,
        extraRoles: Array.isArray(row.extra_roles) ? row.extra_roles : [],
        pageAllowlist: Array.isArray(row.page_allowlist) ? row.page_allowlist : [],
        pageDenylist: Array.isArray(row.page_denylist) ? row.page_denylist : [],
        actionAllowlist: Array.isArray(row.action_allowlist) ? row.action_allowlist : [],
        actionDenylist: Array.isArray(row.action_denylist) ? row.action_denylist : [],
        isDefault: row.is_default === true
    };
}

function buildMembershipAccess(user = {}, rows = [], requestedContext = null) {
    const memberships = rows.map(normalizeMembershipRow).filter(item => item.businessId > 0);
    const requested = requestedContext ? normalizeBusinessContext(requestedContext) : null;
    const active = memberships.find(item => item.businessContext === requested)
        || memberships.find(item => item.isDefault)
        || memberships[0]
        || null;
    const organizationIds = new Set(memberships.map(item => item.organizationId));
    const contexts = memberships.map(item => item.businessContext);
    const requestedMembership = requested
        ? memberships.find(item => item.businessContext === requested)
        : active;
    const membershipEnabled = requestedMembership?.accessMode === 'membership';
    return {
        configured: memberships.length > 0,
        membershipEnabled,
        activeMembership: active,
        memberships,
        organizationIds: [...organizationIds],
        businessContexts: [...new Set(contexts)],
        defaultBusinessContext: memberships.find(item => item.isDefault)?.businessContext || active?.businessContext || null,
        organizationScoped: organizationIds.size <= 1
    };
}

async function loadMembershipAccess(db, user, requestedContext = null) {
    if (!user?.id) return { configured: false, membershipEnabled: false, memberships: [] };
    try {
        const result = await db.query(
            `SELECT om.organization_id, o.slug AS organization_slug, o.name AS organization_name, om.role AS organization_role,
                    bm.business_id, b.context_key, b.label AS business_label, b.short_label AS business_short_label,
                    b.modules AS business_modules, b.access_mode, bm.role, bm.extra_roles, bm.page_allowlist, bm.page_denylist,
                    bm.action_allowlist, bm.action_denylist, bm.is_default
             FROM organization_memberships om
             JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
             JOIN business_memberships bm ON bm.user_id = om.user_id AND bm.is_active IS TRUE
             JOIN businesses b ON b.id = bm.business_id AND b.organization_id = om.organization_id AND b.status = 'active'
             WHERE om.user_id = $1 AND om.is_active IS TRUE
             ORDER BY bm.is_default DESC, b.id ASC`,
            [user.id]
        );
        return buildMembershipAccess(user, result.rows, requestedContext);
    } catch (error) {
        if (isMembershipSchemaMissing(error)) return { configured: false, membershipEnabled: false, memberships: [], schemaUnavailable: true };
        throw error;
    }
}

function applyMembershipAccess(user = {}, access = {}) {
    if (!access?.membershipEnabled || !access.activeMembership) return { ...user, businessMembershipAccess: access };
    const membership = access.activeMembership;
    return {
        ...user,
        role: membership.role,
        extra_roles: membership.extraRoles,
        extraRoles: membership.extraRoles,
        page_allowlist: membership.pageAllowlist,
        pageAllowlist: membership.pageAllowlist,
        page_denylist: membership.pageDenylist,
        pageDenylist: membership.pageDenylist,
        action_allowlist: membership.actionAllowlist,
        actionAllowlist: membership.actionAllowlist,
        action_denylist: membership.actionDenylist,
        actionDenylist: membership.actionDenylist,
        business_contexts: access.businessContexts,
        businessContexts: access.businessContexts,
        default_business_context: access.defaultBusinessContext || membership.businessContext,
        defaultBusinessContext: access.defaultBusinessContext || membership.businessContext,
        organizationId: membership.organizationId,
        organizationRole: membership.organizationRole,
        activeBusinessMembership: membership,
        businessMembershipAccess: access
    };
}

module.exports = {
    applyMembershipAccess,
    buildMembershipAccess,
    isMembershipSchemaMissing,
    loadMembershipAccess,
    normalizeMembershipRow
};
