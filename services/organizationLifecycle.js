'use strict';

const { canUseAction } = require('../middleware/auth');
const { ROLE_HIERARCHY, NON_DELEGABLE_ACTIONS, normalizeActionOverrideList, normalizePageAllowlist, normalizePageDenylist } = require('./accountAccessPolicy');
const { ACTION_PERMISSIONS: ACTION_PERMISSION_ENTRIES, getPublicPagePermissionMetadata } = require('../config/permissionRegistry');
const { normalizeBusinessContext, normalizeKnownBusinessContext, normalizeBusinessScopeMode, BUSINESS_SCOPE_SINGLE } = require('./businessContext');
const { recordAccountSecurityEvent } = require('./accountSecurity');
const { lockOrganizationOwnership } = require('./organizationOwnership');
const { validateBusinessModules, businessModuleCatalog, configuredBusinessModuleEnabled } = require('./businessModuleRegistry');

function failure(status, code, message) {
    const error = new Error(message);
    Object.assign(error, { status, code });
    return error;
}

function positiveId(value, code = 'business_membership_invalid') {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw failure(400, code, 'A valid positive ID is required');
    return id;
}

function has(input, key) {
    return Object.prototype.hasOwnProperty.call(input, key);
}

function stringArray(value) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw failure(400, 'business_membership_invalid', 'Expected an array of strings');
    }
    return [...new Set(value.map(item => item.trim()).filter(Boolean))];
}

function validateMembershipInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure(400, 'business_membership_invalid', 'Membership fields are required');
    positiveId(input.businessId);
    if (has(input, 'role') && (typeof input.role !== 'string' || !ROLE_HIERARCHY.includes(input.role.trim()) || input.role.trim() === 'creator')) {
        throw failure(400, 'business_membership_invalid', 'A valid non-platform business role is required');
    }
    if (has(input, 'organizationRole') && !['owner', 'admin', 'member'].includes(input.organizationRole)) {
        throw failure(400, 'organization_role_invalid', 'Invalid organization role');
    }
    if (has(input, 'isDefault') && typeof input.isDefault !== 'boolean') throw failure(400, 'business_membership_invalid', 'isDefault must be boolean');
    for (const key of ['extraRoles', 'pageAllowlist', 'pageDenylist', 'actionAllowlist', 'actionDenylist']) {
        if (has(input, key)) stringArray(input[key]);
    }
    if (has(input, 'extraRoles') && stringArray(input.extraRoles).some(role => role === 'creator' || !ROLE_HIERARCHY.includes(role))) {
        throw failure(400, 'business_membership_invalid', 'Extra roles must be valid non-platform roles');
    }
}

async function authorizeManager(client, actor, organizationId, ownerOnly) {
    const membership = await client.query(
        `SELECT om.role, om.is_active, u.is_active AS user_active
         FROM organization_memberships om JOIN users u ON u.id = om.user_id
         WHERE om.organization_id = $1 AND om.user_id = $2`, [organizationId, actor.id]
    );
    if (actor.platformRole === 'creator' && canUseAction(actor, 'manage_accounts')) {
        const account = await client.query('SELECT role, is_active FROM users WHERE id = $1', [actor.id]);
        if (account.rows[0]?.role === 'creator' && account.rows[0]?.is_active) return { platform: true, role: 'owner' };
    }
    const current = membership.rows[0];
    if (!current?.is_active || !current.user_active || !(ownerOnly ? ['owner'] : ['owner', 'admin']).includes(current.role)) {
        throw failure(403, 'organization_management_denied', 'Organization management access is required');
    }
    return { platform: false, role: current.role };
}

async function transaction(db, actor, organizationId, ownerOnly, operation) {
    const id = positiveId(organizationId, 'organization_id_invalid');
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await lockOrganizationOwnership(client);
        // All organization lifecycle writers take this lock before checking
        // authority or counting owners, including concurrent self-demotions.
        const organization = await client.query('SELECT id, status FROM organizations WHERE id = $1 FOR UPDATE', [id]);
        if (!organization.rows[0]) throw failure(404, 'organization_not_found', 'Organization not found');
        if (organization.rows[0].status !== 'active') throw failure(403, 'organization_management_denied', 'Organization is inactive');
        const manager = await authorizeManager(client, actor, id, ownerOnly);
        const result = await operation(client, manager, id);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally { client.release(); }
}

async function targetState(client, targetUserId, organizationId, businessId) {
    const account = await client.query('SELECT id, role, is_active FROM users WHERE id = $1', [targetUserId]);
    if (!account.rows[0]) throw failure(404, 'business_member_not_found', 'User not found');
    const organization = await client.query('SELECT role, is_active FROM organization_memberships WHERE organization_id = $1 AND user_id = $2', [organizationId, targetUserId]);
    const business = await client.query(
        `SELECT role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, is_default, is_active
         FROM business_memberships WHERE organization_id = $1 AND user_id = $2 AND business_id = $3`,
        [organizationId, targetUserId, businessId]
    );
    return { account: account.rows[0], organization: organization.rows[0] || null, business: business.rows[0] || null };
}

function authorizeTarget(manager, actor, target, nextOrganizationRole) {
    if (manager.role !== 'admin') return;
    if (Number(actor.id) === Number(target.account.id) || target.account.role === 'creator'
        || (target.organization && target.organization.role !== 'member') || nextOrganizationRole !== 'member') {
        throw failure(403, 'organization_management_denied', 'Administrators may manage other ordinary members only');
    }
}

async function updateBusinessMembership(db, actor, organizationId, targetUserId, input, req) {
    validateMembershipInput(input);
    const userId = positiveId(targetUserId);
    const businessId = positiveId(input.businessId);
    return transaction(db, actor, organizationId, false, async (client, manager, orgId) => {
        const business = await client.query('SELECT id FROM businesses WHERE id = $1 AND organization_id = $2 AND status = \'active\'', [businessId, orgId]);
        if (!business.rows[0]) throw failure(404, 'business_not_found', 'Active business not found in organization');
        const target = await targetState(client, userId, orgId, businessId);
        if (!target.account.is_active) throw failure(409, 'business_member_inactive', 'An active user account is required');
        const current = target.business || {};
        const organizationRole = has(input, 'organizationRole') ? input.organizationRole : target.organization?.role || 'member';
        authorizeTarget(manager, actor, target, organizationRole);
        if (target.organization?.is_active && target.organization.role === 'owner' && organizationRole !== 'owner') {
            const owners = await client.query(
                `SELECT COUNT(*)::int AS count FROM organization_memberships om JOIN users u ON u.id = om.user_id
                 WHERE om.organization_id = $1 AND om.role = 'owner' AND om.is_active IS TRUE AND u.is_active IS TRUE`, [orgId]
            );
            if (owners.rows[0].count <= 1) throw failure(409, 'organization_last_owner', 'The last active organization owner cannot be demoted');
        }
        const role = has(input, 'role') ? input.role.trim() : current.role;
        if (!role) throw failure(400, 'business_membership_invalid', 'A role is required for a new business membership');
        const next = {
            role,
            extraRoles: has(input, 'extraRoles') ? stringArray(input.extraRoles) : current.extra_roles || [],
            pageAllowlist: has(input, 'pageAllowlist') ? normalizePageAllowlist(input.pageAllowlist) : current.page_allowlist || [],
            pageDenylist: has(input, 'pageDenylist') ? normalizePageDenylist(input.pageDenylist) : current.page_denylist || [],
            actionAllowlist: has(input, 'actionAllowlist') ? normalizeActionOverrideList(input.actionAllowlist) : current.action_allowlist || [],
            actionDenylist: has(input, 'actionDenylist') ? normalizeActionOverrideList(input.actionDenylist) : current.action_denylist || [],
            isDefault: has(input, 'isDefault') ? input.isDefault : current.is_default === true
        };
        await client.query(
            `INSERT INTO organization_memberships (organization_id, user_id, role, is_active, created_by_user_id)
             VALUES ($1, $2, $3, true, $4)
             ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, is_active = true`,
            [orgId, userId, organizationRole, actor.id]
        );
        if (next.isDefault) await client.query('UPDATE business_memberships SET is_default = false WHERE user_id = $1 AND organization_id = $2 AND business_id <> $3', [userId, orgId, businessId]);
        const updated = await client.query(
            `INSERT INTO business_memberships (business_id, organization_id, user_id, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, is_default, is_active, created_by_user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
             ON CONFLICT (business_id, user_id) DO UPDATE SET role = EXCLUDED.role, extra_roles = EXCLUDED.extra_roles,
                 page_allowlist = EXCLUDED.page_allowlist, page_denylist = EXCLUDED.page_denylist,
                 action_allowlist = EXCLUDED.action_allowlist, action_denylist = EXCLUDED.action_denylist,
                 is_default = EXCLUDED.is_default, is_active = true
             RETURNING business_id, user_id, role, is_default, is_active`,
            [businessId, orgId, userId, next.role, next.extraRoles, next.pageAllowlist, next.pageDenylist, next.actionAllowlist, next.actionDenylist, next.isDefault, actor.id]
        );
        await recordAccountSecurityEvent({ actor, target: { id: userId }, eventType: 'business_membership_updated',
            details: { organizationId: orgId, businessId, membershipRole: next.role, organizationRole,
                previousOrganizationRole: target.organization?.role || null, before: current, after: next, sessionsRevoked: false }, req, client, strict: true });
        return updated.rows[0];
    });
}

async function deactivateBusinessMembership(db, actor, organizationId, targetUserId, businessId, req) {
    const userId = positiveId(targetUserId);
    const id = positiveId(businessId);
    return transaction(db, actor, organizationId, false, async (client, manager, orgId) => {
        const target = await targetState(client, userId, orgId, id);
        authorizeTarget(manager, actor, target, target.organization?.role || 'member');
        if (!target.business) throw failure(404, 'business_membership_not_found', 'Business membership not found');
        await client.query(
            `UPDATE business_memberships SET is_active = false, is_default = false
             WHERE organization_id = $1 AND user_id = $2 AND business_id = $3`, [orgId, userId, id]
        );
        await recordAccountSecurityEvent({ actor, target: { id: userId }, eventType: 'business_membership_deactivated',
            details: { organizationId: orgId, businessId: id, wasActive: target.business.is_active, sessionsRevoked: false }, req, client, strict: true });
        return { success: true };
    });
}

async function createBusiness(db, actor, organizationId, input, req) {
    const rawContext = String(input?.contextKey || input?.businessContext || '').trim();
    const contextKey = normalizeBusinessContext(rawContext);
    const label = String(input?.label || '').trim();
    const shortLabel = String(input?.shortLabel || label).trim();
    // Built-in data partitions belong to explicit bootstrap/cutover workflows;
    // an organization owner must not claim a legacy partition through creation.
    if (!rawContext || contextKey !== rawContext || normalizeKnownBusinessContext(contextKey)
        || normalizeBusinessScopeMode(contextKey) !== BUSINESS_SCOPE_SINGLE
        || !label || label.length > 160 || !shortLabel || shortLabel.length > 80) {
        throw failure(400, 'business_invalid', 'Valid contextKey, label and shortLabel are required');
    }
    const modules = validateBusinessModules(has(input, 'modules') ? input.modules : [], { contextKey });
    return transaction(db, actor, organizationId, true, async (client, manager, orgId) => {
        const result = await client.query(
            `INSERT INTO businesses (organization_id, context_key, label, short_label, modules, access_mode, created_by_user_id)
             VALUES ($1, $2, $3, $4, $5::jsonb, 'membership', $6)
             RETURNING id, organization_id, context_key, label, short_label, status, access_mode, modules`,
            [orgId, contextKey, label, shortLabel, JSON.stringify(modules), actor.id]
        );
        await recordAccountSecurityEvent({ actor, target: actor, eventType: 'business_created',
            details: { organizationId: orgId, businessId: result.rows[0].id, contextKey }, req, client, strict: true });
        return result.rows[0];
    });
}

async function setBusinessStatus(db, actor, businessId, status, req) {
    const id = positiveId(businessId);
    if (!['active', 'inactive'].includes(status)) throw failure(400, 'business_status_invalid', 'Valid status is required');
    const lookup = await db.query('SELECT organization_id FROM businesses WHERE id = $1', [id]);
    if (!lookup.rows[0]) throw failure(404, 'business_not_found', 'Business not found');
    return transaction(db, actor, lookup.rows[0].organization_id, true, async (client, manager, orgId) => {
        const result = await client.query('UPDATE businesses SET status = $1 WHERE id = $2 AND organization_id = $3 RETURNING id, context_key, status', [status, id, orgId]);
        if (!result.rows[0]) throw failure(404, 'business_not_found', 'Business not found');
        await recordAccountSecurityEvent({ actor, target: actor, eventType: 'business_status_changed',
            details: { businessId: id, status }, req, client, strict: true });
        return result.rows[0];
    });
}

function businessConfiguration(row) {
    return {
        id: Number(row.id), organizationId: Number(row.organization_id), contextKey: row.context_key,
        label: row.label, shortLabel: row.short_label, status: row.status, accessMode: row.access_mode,
        modules: Array.isArray(row.modules) ? row.modules : []
    };
}

function configurationInput(input) {
    const fields = ['label', 'shortLabel', 'modules'];
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || !Object.keys(input).length || Object.keys(input).some(key => !fields.includes(key))) {
        throw failure(400, 'business_configuration_invalid', 'Only label, shortLabel and modules may be changed');
    }
    const next = {};
    for (const [key, max] of [['label', 160], ['shortLabel', 80]]) {
        if (!has(input, key)) continue;
        if (typeof input[key] !== 'string' || !input[key].trim() || input[key].trim().length > max) {
            throw failure(400, 'business_configuration_invalid', 'Valid business labels are required');
        }
        next[key] = input[key].trim();
    }
    if (has(input, 'modules')) next.modules = stringArray(input.modules);
    return next;
}

async function updateBusinessConfiguration(db, actor, businessId, input, req) {
    const id = positiveId(businessId, 'business_id_invalid');
    const next = configurationInput(input);
    const lookup = await db.query('SELECT organization_id FROM businesses WHERE id = $1', [id]);
    if (!lookup.rows[0]) throw failure(404, 'business_not_found', 'Business not found');
    return transaction(db, actor, lookup.rows[0].organization_id, true, async (client, manager, orgId) => {
        const current = await client.query('SELECT * FROM businesses WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, orgId]);
        if (!current.rows[0]) throw failure(404, 'business_not_found', 'Business not found');
        const before = businessConfiguration(current.rows[0]);
        const modules = has(next, 'modules')
            ? validateBusinessModules(next.modules, { contextKey: before.contextKey, existingModules: before.modules })
            : before.modules;
        const result = await client.query(
            `UPDATE businesses SET label = $1, short_label = $2, modules = $3::jsonb
             WHERE id = $4 AND organization_id = $5
             RETURNING id, organization_id, context_key, label, short_label, status, access_mode, modules`,
            [next.label || before.label, next.shortLabel || before.shortLabel, JSON.stringify(modules), id, orgId]
        );
        if (!result.rows[0]) throw failure(404, 'business_not_found', 'Business not found');
        const business = businessConfiguration(result.rows[0]);
        await recordAccountSecurityEvent({ actor, target: actor, eventType: 'business_configuration_updated',
            details: { organizationId: orgId, businessId: id, before, after: business }, req, client, strict: true });
        return business;
    });
}

async function initializeBusinessResources(db, actor, businessId, input = {}, req) {
    const id = positiveId(businessId, 'business_id_invalid');
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'types')) {
        throw failure(400, 'business_resources_invalid', 'Only resource types may be supplied');
    }
    const types = has(input, 'types') ? stringArray(input.types) : ['cabinet', 'specialist', 'room'];
    if (!types.length || types.some(type => !['cabinet', 'specialist', 'room'].includes(type))) {
        throw failure(400, 'business_resources_invalid', 'Supported resource types are cabinet, specialist and room');
    }
    const lookup = await db.query('SELECT organization_id FROM businesses WHERE id = $1', [id]);
    if (!lookup.rows[0]) throw failure(404, 'business_not_found', 'Business not found');
    return transaction(db, actor, lookup.rows[0].organization_id, true, async (client, manager, orgId) => {
        const result = await client.query('SELECT * FROM businesses WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, orgId]);
        const business = result.rows[0];
        if (!business) throw failure(404, 'business_not_found', 'Business not found');
        if (business.status !== 'active') throw failure(409, 'business_inactive', 'Active business is required');
        if (!configuredBusinessModuleEnabled(business, 'timeline')) {
            throw failure(403, 'business_module_disabled', 'Timeline is unavailable for this business');
        }
        const { initializeTimelineResources } = require('./timelineResources');
        const initialization = await initializeTimelineResources(client, business.context_key, { types });
        await recordAccountSecurityEvent({ actor, target: actor, eventType: 'business_resources_initialized',
            details: { organizationId: orgId, businessId: id, ...initialization }, req, client, strict: true });
        return initialization;
    });
}

async function manageableOrganizations(db, actor) {
    const account = await db.query('SELECT id, role, is_active FROM users WHERE id = $1', [actor.id]);
    if (!account.rows[0]?.is_active) throw failure(403, 'organization_management_denied', 'Organization management access is required');
    const platform = account.rows[0].role === 'creator' && actor.platformRole === 'creator' && canUseAction(actor, 'manage_accounts');
    const result = await db.query(
        `SELECT o.id, o.name, o.slug, om.role AS organization_role
         FROM organizations o
         LEFT JOIN organization_memberships om ON om.organization_id = o.id AND om.user_id = $1 AND om.is_active IS TRUE
         WHERE o.status = 'active' AND ($2::boolean OR om.role IN ('owner', 'admin'))
         ORDER BY o.id`, [actor.id, platform]
    );
    if (!result.rows.length) throw failure(403, 'organization_management_denied', 'Organization management access is required');
    return { platform, organizations: result.rows.map(row => ({
        id: Number(row.id), name: row.name, slug: row.slug, role: platform ? 'owner' : row.organization_role
    })) };
}

async function getOrganizationManagement(db, actor) {
    const management = await manageableOrganizations(db, actor);
    const result = await db.query(
        `SELECT id, organization_id, context_key, label, short_label, status, access_mode, modules
         FROM businesses WHERE organization_id = ANY($1::int[]) ORDER BY organization_id, id`,
        [management.organizations.map(organization => organization.id)]
    );
    return {
        organizations: management.organizations.map(organization => {
            const owner = organization.role === 'owner';
            return {
                ...organization, canCreateBusiness: owner, canEditBusinesses: owner,
                businesses: result.rows.filter(row => Number(row.organization_id) === organization.id).map(row => ({
                    ...businessConfiguration(row),
                    moduleCatalog: businessModuleCatalog(row.context_key).map(module => ({
                        ...module, enabled: configuredBusinessModuleEnabled(row, module.key)
                    })),
                    canInitializeResources: owner && row.status === 'active' && configuredBusinessModuleEnabled(row, 'timeline')
                }))
            };
        }),
        moduleRegistry: businessModuleCatalog('custom_business')
    };
}

function mayManageTarget(manager, actor, account, organization) {
    try {
        authorizeTarget(manager, actor, { account, organization }, organization?.role || 'member');
        return true;
    } catch (error) {
        if (error.code === 'organization_management_denied') return false;
        throw error;
    }
}

async function listOrganizationMembers(db, actor) {
    const management = await manageableOrganizations(db, actor);
    const result = await db.query(
        `SELECT u.id, u.username, u.name, u.role AS account_role, om.organization_id, om.role AS organization_role
         FROM organization_memberships om JOIN users u ON u.id = om.user_id
         WHERE om.organization_id = ANY($1::int[]) AND om.is_active IS TRUE AND u.is_active IS TRUE
         ORDER BY u.name, u.id`, [management.organizations.map(organization => organization.id)]
    );
    const members = new Map();
    for (const row of result.rows) {
        const organization = management.organizations.find(item => item.id === Number(row.organization_id));
        if (mayManageTarget(organization, actor, { id: row.id, role: row.account_role }, { role: row.organization_role })) {
            members.set(Number(row.id), { id: Number(row.id), username: row.username, name: row.name });
        }
    }
    return { members: [...members.values()], organizations: management.organizations, canManageBusinesses: true };
}

async function getMemberAccessProfile(db, actor, targetUserId) {
    const userId = positiveId(targetUserId);
    const management = await manageableOrganizations(db, actor);
    const account = await db.query('SELECT id, role, is_active FROM users WHERE id = $1', [userId]);
    if (!account.rows[0]) throw failure(404, 'business_member_not_found', 'User not found');
    const targetOrganizations = await db.query(
        'SELECT organization_id, role, is_active FROM organization_memberships WHERE user_id = $1', [userId]
    );
    const activeTargetOrganizations = targetOrganizations.rows.filter(row => row.is_active);
    if (!management.platform && activeTargetOrganizations.length
        && !activeTargetOrganizations.some(row => management.organizations.some(organization => organization.id === Number(row.organization_id)))) {
        throw failure(403, 'organization_management_denied', 'Organization management access is required');
    }
    const allowedOrganizations = management.organizations.filter(organization => {
        const targetOrganization = targetOrganizations.rows.find(row => Number(row.organization_id) === organization.id) || null;
        return mayManageTarget(organization, actor, account.rows[0], targetOrganization);
    });
    if (!allowedOrganizations.length) throw failure(403, 'organization_management_denied', 'Organization management access is required');
    const result = await db.query(
        `SELECT b.id, b.organization_id, b.context_key, b.label, b.status, b.access_mode,
                bm.user_id AS member_user_id, bm.role, bm.extra_roles, bm.page_allowlist, bm.page_denylist,
                bm.action_allowlist, bm.action_denylist, bm.is_default, bm.is_active
         FROM businesses b LEFT JOIN business_memberships bm
           ON bm.business_id = b.id AND bm.organization_id = b.organization_id AND bm.user_id = $1
         WHERE b.organization_id = ANY($2::int[]) ORDER BY b.organization_id, b.id`,
        [userId, allowedOrganizations.map(organization => organization.id)]
    );
    const registry = await db.query(
        `SELECT context_key FROM businesses WHERE access_mode = 'membership'
         AND ($1::boolean OR organization_id = ANY($2::int[])) ORDER BY context_key`,
        [management.platform, allowedOrganizations.map(organization => organization.id)]
    );
    return {
        userId,
        organizations: allowedOrganizations.map(organization => ({
            ...organization,
            businesses: result.rows.filter(row => Number(row.organization_id) === organization.id).map(row => {
                const organizationMembership = targetOrganizations.rows.find(item => Number(item.organization_id) === organization.id);
                return {
                    id: Number(row.id), contextKey: row.context_key, label: row.label, status: row.status, accessMode: row.access_mode,
                    membership: row.member_user_id == null ? null : {
                        role: row.role, extraRoles: row.extra_roles || [], pageAllowlist: row.page_allowlist || [], pageDenylist: row.page_denylist || [],
                        actionAllowlist: row.action_allowlist || [], actionDenylist: row.action_denylist || [],
                        isDefault: row.is_default === true, isActive: row.is_active === true,
                        organizationRole: organizationMembership?.role || 'member'
                    },
                    canEdit: row.status === 'active' && account.rows[0].is_active === true,
                    canDeactivate: row.member_user_id != null && row.is_active === true,
                    canManageOrganizationRole: organization.role === 'owner'
                };
            })
        })),
        membershipContextKeys: registry.rows.map(row => row.context_key),
        permissionCatalog: {
            roles: ROLE_HIERARCHY.filter(role => role !== 'creator'),
            pages: getPublicPagePermissionMetadata().map(page => ({
                key: page.key, canonicalPath: page.canonicalPath, aliases: page.aliases, label: page.label,
                group: page.groupLabel || page.group, defaultRoles: page.roles, explicitAllow: page.explicitAllow
            })),
            actions: ACTION_PERMISSION_ENTRIES.filter(action => action.deprecated !== true).map(action => ({
                key: action.key, label: action.label, group: action.group, defaultRoles: action.defaultRoles,
                delegable: !NON_DELEGABLE_ACTIONS.has(action.key), explicitAllow: action.explicitAllow !== false
            }))
        },
        canEditAccount: management.platform
    };
}

module.exports = { createBusiness, deactivateBusinessMembership, getMemberAccessProfile, getOrganizationManagement,
    initializeBusinessResources, listOrganizationMembers, setBusinessStatus, updateBusinessConfiguration, updateBusinessMembership };
