'use strict';

const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext, normalizeBusinessContextList, normalizeKnownBusinessContext } = require('./businessContext');
const { normalizeRoleList } = require('./accountAccessPolicy');

const MEMBERSHIP_SCHEMA_MISSING = new Set(['42P01', '42703']);

function isMembershipSchemaMissing(error) {
    return MEMBERSHIP_SCHEMA_MISSING.has(error?.code)
        || /relation .*organizations.* does not exist|relation .*business_memberships.* does not exist/i.test(String(error?.message || ''));
}

function isNodeTestDoubleQuery(error) {
    return /^Unexpected (?:[\w-]+\s+)*(?:SQL\s+)?query:|^Unexpected SQL in .+ test:/i.test(String(error?.message || ''));
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

function normalizeRegistryRow(row) {
    return {
        businessId: Number(row.business_id),
        organizationId: Number(row.organization_id),
        businessContext: normalizeBusinessContext(row.context_key),
        accessMode: row.access_mode,
        active: (row.business_status || 'active') === 'active'
            && (row.organization_status || 'active') === 'active'
    };
}

function buildMembershipAccess(user = {}, rows = [], requestedContext = null, registryRows = rows) {
    const registry = registryRows.map(normalizeRegistryRow);
    const registryByContext = new Map(registry.map(item => [item.businessContext, item]));
    const memberships = rows.map(normalizeMembershipRow).filter(item => item.businessId > 0
        && registryByContext.get(item.businessContext)?.active !== false);
    const raw = String(requestedContext || '').trim().toLowerCase();
    const scopeAlias = ['all', 'all-business', 'all_business', 'overview', 'multi', 'many', 'selected', 'several'].includes(raw);
    const explicit = Boolean(raw && !scopeAlias);
    const malformed = explicit && !normalizeKnownBusinessContext(raw) && !/^[a-z][a-z0-9_]{2,63}$/.test(raw);
    const requested = explicit ? normalizeBusinessContext(raw) : null;
    const defaultMembership = memberships.find(item => item.isDefault) || memberships[0] || null;
    const defaultContext = defaultMembership?.businessContext
        || normalizeBusinessContext(user.defaultBusinessContext || user.default_business_context || DEFAULT_BUSINESS_CONTEXT);
    const selectedContext = requested || defaultContext;
    const business = registryByContext.get(selectedContext);
    const active = memberships.find(item => item.businessContext === selectedContext) || null;
    const organizationIds = new Set(memberships.map(item => item.organizationId));
    const membershipEnabled = business?.accessMode === 'membership';
    const platformRole = user.platformRole || user.role;
    let reason = null;
    if (malformed || business?.active === false
        || (membershipEnabled && !active)
        || (explicit && !business && !normalizeKnownBusinessContext(raw))) {
        reason = 'business_context_unavailable';
    } else if (!explicit && organizationIds.size > 1) {
        // Do not choose an organization by SQL row order.
        reason = 'business_context_required';
    } else if (membershipEnabled && active?.role === 'creator' && platformRole !== 'creator') {
        reason = 'business_membership_role_invalid';
    }
    return {
        configured: registry.length > 0,
        membershipEnabled,
        activeMembership: active,
        memberships,
        registry,
        invalid: Boolean(reason),
        reason,
        organizationIds: [...organizationIds],
        businessContexts: [...new Set(memberships.filter(item => item.accessMode === 'membership').map(item => item.businessContext))],
        defaultBusinessContext: defaultContext,
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
        const contexts = normalizeBusinessContextList([
            DEFAULT_BUSINESS_CONTEXT,
            ...(user.businessContexts || user.business_contexts || []),
            user.defaultBusinessContext || user.default_business_context || DEFAULT_BUSINESS_CONTEXT,
            ...(requestedContext ? [requestedContext] : []),
            ...result.rows.map(row => row.context_key)
        ], []);
        // The registry is independent of the user's active memberships. A revoked
        // member must not turn a migrated business back into legacy authorization.
        const registry = await db.query(
            `SELECT b.id AS business_id, b.organization_id, b.context_key, b.access_mode,
                    b.status AS business_status, o.status AS organization_status
             FROM businesses b JOIN organizations o ON o.id = b.organization_id
             WHERE b.context_key = ANY($1::text[])`,
            [contexts]
        );
        return buildMembershipAccess(user, result.rows, requestedContext, registry.rows);
    } catch (error) {
        // Explicit Node test doubles may omit this schema. Runtime SQL failures,
        // including a missing table, must never restore permissions from a JWT.
        if (process.env.NODE_TEST_CONTEXT && isNodeTestDoubleQuery(error)) {
            return { configured: false, membershipEnabled: false, memberships: [], organizationIds: [], testDoubleUnavailable: true };
        }
        throw error;
    }
}

function applyMembershipAccess(user = {}, access = {}) {
    const platformRole = user.platformRole || user.role;
    if (!access?.membershipEnabled && !access.invalid) return { ...user, platformRole, businessMembershipAccess: access };
    const membership = access.activeMembership;
    const role = access.invalid ? null : membership?.role || null;
    const extraRoles = (access.invalid ? [] : membership?.extraRoles || []).filter(item => item !== 'creator' || platformRole === 'creator');
    const pageAllowlist = access.invalid ? [] : membership?.pageAllowlist || [];
    const pageDenylist = access.invalid ? [] : membership?.pageDenylist || [];
    const actionAllowlist = access.invalid ? [] : membership?.actionAllowlist || [];
    const actionDenylist = access.invalid ? [] : membership?.actionDenylist || [];
    return {
        ...user,
        platformRole,
        role,
        roles: normalizeRoleList({ role, extraRoles }),
        extra_roles: extraRoles,
        extraRoles,
        page_allowlist: pageAllowlist,
        pageAllowlist,
        page_denylist: pageDenylist,
        pageDenylist,
        action_allowlist: actionAllowlist,
        actionAllowlist,
        action_denylist: actionDenylist,
        actionDenylist,
        business_contexts: access.businessContexts,
        businessContexts: access.businessContexts,
        default_business_context: access.defaultBusinessContext,
        defaultBusinessContext: access.defaultBusinessContext,
        organizationId: membership?.organizationId || null,
        organizationRole: membership?.organizationRole || null,
        activeBusinessMembership: membership,
        businessMembershipAccess: access
    };
}

module.exports = {
    applyMembershipAccess,
    buildMembershipAccess,
    isNodeTestDoubleQuery,
    isMembershipSchemaMissing,
    loadMembershipAccess,
    normalizeMembershipRow
};
