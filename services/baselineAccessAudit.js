'use strict';

const baseline = require('../docs/access-baseline/production-083120.json');
const { PAGE_PERMISSIONS, ACTION_PERMISSIONS } = require('../config/permissionRegistry');
const { resolveCapability, normalizeRoleList } = require('./accountAccessPolicy');
const { applyMembershipAccess } = require('./businessMembership');
const { REQUIRED_WORK_PAGES, assessAccountWorkReadiness } = require('./accountWorkReadiness');

const PROFESSION_ROLES = Object.freeze({ trampoline_instructor: 'instructor', cleaner: 'cleaning',
    technician: 'maintenance', head_cook: 'head_chef', bartender: 'barista', hr_manager: 'hr',
    pizzaiolo: 'cook', host: 'animator', intern: 'animator' });

function previousDecision(user, entry, type) {
    const current = resolveCapability(user, entry.key, { type });
    if (current.source !== 'role_preset' && current.reason !== 'no_matching_grant') return current.allowed;
    const roles = baseline[type === 'page' ? 'pages' : 'actions'][entry.key] || [];
    const candidates = type === 'action' && entry.delegable === false ? [user.role] : normalizeRoleList(user);
    return candidates.some(role => roles.includes(role));
}

function comparePreset(user) {
    const changes = [];
    for (const [type, entries] of [['page', PAGE_PERMISSIONS], ['action', ACTION_PERMISSIONS.filter(entry => !entry.deprecated)]]) {
        for (const entry of entries) {
            const before = previousDecision(user, entry, type);
            const after = resolveCapability(user, entry.key, { type }).allowed;
            if (before !== after) changes.push({ capability: `${type}:${entry.key}`, before, after });
        }
    }
    return changes;
}

function auditAccount({ user, access, profiles = [] }) {
    const effective = applyMembershipAccess(user, access);
    const professions = [...new Set(profiles.map(profile => profile.profession).filter(Boolean))];
    const expectedRoles = professions.map(key => PROFESSION_ROLES[key] || key);
    const exceptions = {
        pagesAllowed: effective.page_allowlist || [], pagesDenied: effective.page_denylist || [],
        actionsAllowed: effective.action_allowlist || [], actionsDenied: effective.action_denylist || []
    };
    const missingMembership = access.membershipEnabled !== true || access.invalid || !access.activeMembership;
    const profile = profiles.length === 1 ? profiles[0] : null;
    const readiness = assessAccountWorkReadiness({ user, access,
        staff: profile ? { id: profile.staff_id, is_active: profile.staff_active } : null,
        profile: profile ? { id: profile.profile_id, userId: user.id, staffId: profile.staff_id } : null });
    const primaryOnly = { ...effective, roles: [effective.role], extra_roles: [], extraRoles: [] };
    const additionalRoleGrants = ['manage_accounts', 'manage_settings', 'finance.manage', 'hr.staff.manage',
        'edit_booking', 'view_all', 'tasks.scope.business'].filter(key =>
        resolveCapability(effective, key).allowed && !resolveCapability(primaryOnly, key).allowed);
    return {
        accountId: user.id,
        businessContext: access.activeMembership?.businessContext || null,
        membershipMissing: Boolean(missingMembership),
        profileCount: profiles.length,
        effectiveRole: effective.role || null,
        professionRoleMismatch: expectedRoles.length > 0 && !expectedRoles.includes(effective.role),
        expectedRoles,
        blockedWorkPages: REQUIRED_WORK_PAGES.filter(page => !resolveCapability(effective, page, { type: 'page' }).allowed),
        unavailableWorkModules: readiness.checks.modules.results.filter(module => !module.available)
            .map(({ module, code }) => ({ module, code })),
        responsibilityNodeAvailable: Boolean(profile?.company_structure_node_id),
        additionalRoles: effective.extra_roles || [],
        additionalRoleGrants,
        exceptions,
        impact: comparePreset(effective),
        nextAction: missingMembership ? 'explicit_membership_review'
            : profiles.length !== 1 ? 'review_staff_bridge'
            : 'review_role_and_exceptions',
        automaticFix: false
    };
}

module.exports = { comparePreset, auditAccount };
