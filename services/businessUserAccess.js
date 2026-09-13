'use strict';

const { canAccessBusinessContext } = require('./businessContext');

// Candidate directories and assignments use the same business as the acting
// membership. Global user roles remain relevant only on compatibility paths.
function businessUserAccessSql(actor, params, alias = 'users', businessScope = null) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid user SQL alias');
    const access = actor?.businessMembershipAccess;
    const active = actor?.activeBusinessMembership;
    const context = (typeof businessScope === 'string' ? businessScope
        : businessScope?.activeContext || businessScope?.businessContext) || active?.businessContext;
    const membershipMode = access?.membershipEnabled === true
        || access?.registry?.some(item => item.businessContext === context && item.accessMode === 'membership') === true;
    const denied = { condition: 'AND FALSE', roleSql: 'NULL::text', extraRolesSql: "'{}'::text[]", membershipMode: true };
    if (access?.invalid || businessScope?.invalid) return denied;
    if (!membershipMode && access?.configured && context && !canAccessBusinessContext(actor, context)) return denied;
    if (!membershipMode) return { condition: '', roleSql: `${alias}.role`, extraRolesSql: `${alias}.extra_roles`, membershipMode: false };
    if (!active || active.businessContext !== context || !Number.isSafeInteger(active.businessId)
        || !Number.isSafeInteger(active.organizationId)) return denied;

    params.push(active.businessId, active.organizationId);
    const businessRef = `$${params.length - 1}`;
    const organizationRef = `$${params.length}`;
    const source = `FROM business_memberships candidate_bm
        JOIN businesses candidate_b ON candidate_b.id = candidate_bm.business_id
          AND candidate_b.organization_id = candidate_bm.organization_id
          AND candidate_b.status = 'active' AND candidate_b.access_mode = 'membership'
        JOIN organizations candidate_o ON candidate_o.id = candidate_b.organization_id AND candidate_o.status = 'active'
        JOIN organization_memberships candidate_om ON candidate_om.organization_id = candidate_o.id
          AND candidate_om.user_id = candidate_bm.user_id AND candidate_om.is_active IS TRUE
        WHERE candidate_bm.user_id = ${alias}.id AND candidate_bm.business_id = ${businessRef}
          AND candidate_bm.organization_id = ${organizationRef} AND candidate_bm.is_active IS TRUE
          AND (candidate_bm.role <> 'creator' OR ${alias}.role = 'creator')`;
    return {
        condition: `AND EXISTS (SELECT 1 ${source})`,
        roleSql: `(SELECT candidate_bm.role ${source})`,
        extraRolesSql: `(SELECT candidate_bm.extra_roles ${source})`,
        membershipMode: true
    };
}

module.exports = { businessUserAccessSql };
