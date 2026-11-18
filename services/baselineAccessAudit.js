'use strict';

const baseline = require('../docs/access-baseline/production-083120.json');
const { PAGE_PERMISSIONS, ACTION_PERMISSIONS, ROLE_HIERARCHY } = require('../config/permissionRegistry');
const { resolveCapability, normalizeRoleList } = require('./accountAccessPolicy');
const { applyMembershipAccess } = require('./businessMembership');
const { REQUIRED_WORK_PAGES, assessAccountWorkReadiness } = require('./accountWorkReadiness');

const PROFESSION_ROLES = Object.freeze({ trampoline_instructor: 'instructor', cleaner: 'cleaning',
    technician: 'maintenance', head_cook: 'head_chef', bartender: 'barista', hr_manager: 'hr',
    pizzaiolo: 'cook', host: 'animator', intern: 'animator' });
const KNOWN_ROLES = new Set(ROLE_HIERARCHY);
const KNOWN_PAGES = new Set(PAGE_PERMISSIONS.map(entry => entry.key));
const KNOWN_ACTIONS = new Set(ACTION_PERMISSIONS.map(entry => entry.key));

function knownValues(values, allowed) {
    return Array.isArray(values) ? values.filter(value => typeof value === 'string' && allowed.has(value)) : [];
}

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
    const mappedProfessions = professions.map(key => PROFESSION_ROLES[key] || key);
    const expectedRoles = knownValues(mappedProfessions, KNOWN_ROLES);
    const rawExceptions = {
        pagesAllowed: effective.page_allowlist, pagesDenied: effective.page_denylist,
        actionsAllowed: effective.action_allowlist, actionsDenied: effective.action_denylist
    };
    const exceptions = {
        pagesAllowed: knownValues(rawExceptions.pagesAllowed, KNOWN_PAGES),
        pagesDenied: knownValues(rawExceptions.pagesDenied, KNOWN_PAGES),
        actionsAllowed: knownValues(rawExceptions.actionsAllowed, KNOWN_ACTIONS),
        actionsDenied: knownValues(rawExceptions.actionsDenied, KNOWN_ACTIONS)
    };
    // Report malformed/stale values as counts, never arbitrary stored strings.
    // Permission resolution still consumes the original effective account.
    const unrecognizedExceptionCounts = Object.fromEntries(Object.entries(rawExceptions).map(([key, values]) =>
        [key, values == null ? 0 : Array.isArray(values) ? values.length - exceptions[key].length : 1]));
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
        effectiveRole: KNOWN_ROLES.has(effective.role) ? effective.role : null,
        professionRoleMismatch: mappedProfessions.length > 0
            && (mappedProfessions.length !== expectedRoles.length || !expectedRoles.includes(effective.role)),
        expectedRoles,
        unknownProfessionCount: mappedProfessions.length - expectedRoles.length,
        blockedWorkPages: REQUIRED_WORK_PAGES.filter(page => !resolveCapability(effective, page, { type: 'page' }).allowed),
        unavailableWorkModules: readiness.checks.modules.results.filter(module => !module.available)
            .map(({ module, code }) => ({ module, code })),
        responsibilityNodeAvailable: Boolean(profile?.company_structure_node_id),
        additionalRoles: knownValues(effective.extra_roles, KNOWN_ROLES),
        unknownAdditionalRoleCount: effective.extra_roles == null ? 0 : Array.isArray(effective.extra_roles)
            ? effective.extra_roles.length - knownValues(effective.extra_roles, KNOWN_ROLES).length : 1,
        additionalRoleGrants,
        exceptions,
        unrecognizedExceptionCounts,
        impact: comparePreset(effective),
        nextAction: missingMembership ? 'explicit_membership_review'
            : profiles.length !== 1 ? 'review_staff_bridge'
            : 'review_role_and_exceptions',
        automaticFix: false
    };
}

module.exports = { comparePreset, auditAccount };
