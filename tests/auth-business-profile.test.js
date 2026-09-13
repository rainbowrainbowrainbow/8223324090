'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolveAuthBusinessContext, authBusinessUserFields } = require('../services/authBusinessProfile');
const { buildAuthUserPayload } = require('../middleware/auth');
const lifecycle = require('../services/organizationLifecycle');

function membership(context, id, role = 'animator', organizationId = 7) {
    return { organization_id: organizationId, organization_slug: 'fixture', organization_name: 'Fixture', organization_role: 'member',
        business_id: id, context_key: context, business_label: context, business_short_label: context, business_modules: ['tasks'],
        access_mode: 'membership', role, extra_roles: [], page_allowlist: [], page_denylist: ['/finance'],
        action_allowlist: [], action_denylist: ['view_revenue'], is_default: context === 'event_genix' };
}

function accessFixture() {
    const user = { id: 42, username: 'fixture_member', role: 'director', extra_roles: ['accountant'],
        page_allowlist: ['/finance'], action_allowlist: ['view_revenue'], business_contexts: ['event_genix', 'dar'], default_business_context: 'event_genix' };
    const state = { memberships: [membership('event_genix', 11, 'manager'), membership('dar', 12)], calls: [] };
    const db = { async query(sql, params) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        state.calls.push({ sql: text, params });
        if (text.includes('FROM organization_memberships om') && text.includes('JOIN business_memberships bm')) return { rows: state.memberships };
        if (text.includes('FROM businesses b JOIN organizations')) return { rows: ['event_genix', 'dar', 'fixture_other'].filter(context => params[0].includes(context)).map(context => ({
            business_id: context === 'event_genix' ? 11 : context === 'dar' ? 12 : 21,
            context_key: context, organization_id: context === 'fixture_other' ? 8 : 7, access_mode: 'membership', business_status: 'active', organization_status: 'active'
        })) };
        throw new Error('Unexpected profile fixture SQL: ' + text);
    } };
    return { db, user, state };
}

test('response projection selects requested membership from body, query or header without global grants', async () => {
    const f = accessFixture();
    for (const request of [{ body: { businessContext: 'dar' } }, { query: { business_context: 'dar' } }, { headers: { 'x-business-context': 'dar' } }]) {
        const resolved = await resolveAuthBusinessContext(f.db, f.user, request);
        const user = { ...buildAuthUserPayload(resolved.user), ...authBusinessUserFields(resolved.user, resolved.scope) };
        assert.equal(user.role, 'animator');
        assert.deepEqual(user.extraRoles, []);
        assert.deepEqual(user.pageAllowlist, []);
        assert.deepEqual(user.pageDenylist, ['/finance']);
        assert.deepEqual(user.actionDenylist, ['view_revenue']);
        assert.equal(user.platformRole, 'director');
        assert.equal(user.activeBusinessContext, 'dar');
        assert.deepEqual(user.accessContext, { status: 'ready', code: null });
        assert.equal(user.membershipConfigured, true);
    }
});

test('multiple organizations require explicit selection and never expose row-order grants', async () => {
    const f = accessFixture();
    f.state.memberships.push(membership('fixture_other', 21, 'director', 8));
    const resolved = await resolveAuthBusinessContext(f.db, f.user);
    const user = { ...buildAuthUserPayload(resolved.user), ...authBusinessUserFields(resolved.user, resolved.scope) };
    assert.equal(user.role, null);
    assert.deepEqual(user.roles, []);
    assert.deepEqual(user.accessContext, { status: 'selection_required', code: 'business_context_required' });
    assert.equal(user.activeBusinessContext, null);
    assert.equal(user.activeBusinessMembership, null);
    assert.deepEqual(user.businessContexts, ['event_genix', 'dar', 'fixture_other']);
    assert.equal((await resolveAuthBusinessContext(f.db, f.user, { query: { businessContext: 'fixture_other' } })).user.role, 'director');
});

test('revoked and malformed contexts preserve identity but clear operational roles and overrides', async () => {
    const f = accessFixture();
    for (const value of ['fixture_unknown', '', ['dar'], false]) {
        const resolved = await resolveAuthBusinessContext(f.db, f.user, { body: { businessContext: value } });
        assert.equal(resolved.explicitContext, true);
        assert.equal(resolved.accessContext.status, 'unavailable');
        assert.equal(resolved.user.id, 42);
        assert.equal(resolved.user.role, null);
        assert.deepEqual(resolved.user.roles, []);
        assert.deepEqual(resolved.user.pageAllowlist, []);
        assert.deepEqual(resolved.user.actionAllowlist, []);
    }
    f.state.memberships = [];
    const resolved = await resolveAuthBusinessContext(f.db, f.user);
    const user = { ...buildAuthUserPayload(resolved.user), ...authBusinessUserFields(resolved.user, resolved.scope) };
    assert.equal(user.id, 42);
    assert.deepEqual(user.businessContexts, []);
    assert.deepEqual(user.businessContextPolicy.allowed, []);
    assert.equal(user.defaultBusinessContext, null);
    assert.equal(user.activeBusinessContext, null);
});

test('an aggregate permissions mismatch never lends the active role to the response', async () => {
    const f = accessFixture();
    const resolved = await resolveAuthBusinessContext(f.db, f.user, { query: { businessContext: 'all' } });
    assert.equal(resolved.scope.reason, 'business_scope_permissions_mismatch');
    assert.equal(resolved.user.role, null);
    assert.deepEqual(resolved.user.roles, []);
});

test('profile with no available business performs no cabinet reads and retains owner organization discovery', async t => {
    const f = accessFixture();
    f.state.memberships = [];
    const resolved = await resolveAuthBusinessContext(f.db, f.user);
    const { buildBusinessOperatingProfile } = require('../services/businessProfile');
    const calls = [];
    const db = { async query(sql, params) {
        calls.push(String(sql));
        assert.match(sql, /SELECT o.id, o.slug, o.name, o.status, om.role AS organization_role/);
        assert.deepEqual(params, [42]);
        return { rows: [{ id: 7, slug: 'fixture', name: 'Fixture', status: 'active', organization_role: 'owner' }] };
    } };
    const profile = await buildBusinessOperatingProfile(db, resolved.user, { scope: resolved.scope, includeOrganizations: true, includeIntegrations: false });
    assert.equal(profile.activeBusinessContext, null);
    assert.equal(profile.activeProfile, null);
    assert.deepEqual(profile.businesses, []);
    assert.deepEqual(profile.allowedBusinessIds, []);
    assert.deepEqual(profile.scope.selectedContexts, []);
    assert.equal(profile.scope.canWrite, false);
    assert.equal(profile.organizations[0].role, 'owner');
    assert.equal(calls.length, 1);
});

function managementFixture() {
    const state = { actorRole: 'manager', managerRole: 'owner', targetRole: 'animator', targetOrganizationRole: 'member', targetOrganizationId: 7, calls: [] };
    const actor = { id: 1, role: 'manager', platformRole: 'manager' };
    const db = { async query(sql, params) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        assert.match(text, /^SELECT /, 'Management discovery must never mutate data');
        state.calls.push({ sql: text, params });
        if (text === 'SELECT id, role, is_active FROM users WHERE id = $1') return { rows: [{ id: params[0], role: params[0] === 1 ? state.actorRole : state.targetRole, is_active: true }] };
        if (text.startsWith('SELECT o.id, o.name, o.slug, om.role')) return { rows: [{ id: 7, name: 'Fixture', slug: 'fixture', organization_role: state.managerRole }] };
        if (text.startsWith('SELECT organization_id, role, is_active FROM organization_memberships')) return { rows: [{ organization_id: state.targetOrganizationId, role: state.targetOrganizationRole, is_active: true }] };
        if (text.startsWith('SELECT b.id, b.organization_id')) return { rows: [{ id: 12, organization_id: 7, context_key: 'dar', label: 'Dar', status: 'active', access_mode: 'membership',
            member_user_id: 42, role: 'animator', extra_roles: [], page_allowlist: [], page_denylist: ['/finance'], action_allowlist: [], action_denylist: ['view_revenue'], is_default: true, is_active: true }] };
        if (text.startsWith('SELECT context_key FROM businesses')) {
            assert.match(text, /AND \(\$1::boolean OR organization_id = ANY\(\$2::int\[\]\)\)/);
            const registry = [
                { organization_id: 7, context_key: 'dar' }, { organization_id: 7, context_key: 'event_genix' },
                { organization_id: 8, context_key: 'foreign_private_business' }
            ];
            return { rows: registry.filter(row => params[0] || params[1].includes(row.organization_id)) };
        }
        if (text.startsWith('SELECT u.id, u.username, u.name, u.role AS account_role')) return { rows: [
            { id: 1, username: 'fixture_actor', name: 'Actor', account_role: state.actorRole, organization_id: 7, organization_role: state.managerRole },
            { id: 42, username: 'fixture_target', name: 'Target', account_role: state.targetRole, organization_id: 7, organization_role: state.targetOrganizationRole }
        ] };
        throw new Error('Unexpected management fixture SQL: ' + text);
    } };
    return { state, actor, db };
}

test('owner discovery exposes own membership overrides without global account editing authority', async () => {
    const f = managementFixture();
    const profile = await lifecycle.getMemberAccessProfile(f.db, f.actor, 42);
    assert.equal(profile.canEditAccount, false);
    assert.deepEqual(profile.membershipContextKeys, ['dar', 'event_genix']);
    assert.equal(JSON.stringify(profile).includes('foreign_private_business'), false);
    assert.deepEqual(f.state.calls.find(call => call.sql.startsWith('SELECT context_key')).params, [false, [7]]);
    assert.deepEqual(profile.organizations[0].businesses[0].membership.actionDenylist, ['view_revenue']);
    assert.equal(profile.organizations[0].businesses[0].canEdit, true);
    assert.equal(profile.organizations[0].businesses[0].canManageOrganizationRole, true);
});

test('admin discovery rejects self, owner, admin and platform target with no business rows queried', async () => {
    const f = managementFixture();
    f.state.managerRole = 'admin';
    for (const role of ['owner', 'admin']) {
        f.state.targetOrganizationRole = role;
        await assert.rejects(lifecycle.getMemberAccessProfile(f.db, f.actor, 42), { status: 403, code: 'organization_management_denied' });
    }
    f.state.targetOrganizationRole = 'member';
    f.state.targetRole = 'creator';
    await assert.rejects(lifecycle.getMemberAccessProfile(f.db, f.actor, 42), { status: 403 });
    f.state.targetRole = 'animator';
    await assert.rejects(lifecycle.getMemberAccessProfile(f.db, f.actor, 1), { status: 403 });
    assert.equal(f.state.calls.some(call => call.sql.startsWith('SELECT b.id')), false);
});

test('foreign target discovery denies instead of exposing memberships from another organization', async () => {
    const f = managementFixture();
    f.state.targetOrganizationId = 8;
    await assert.rejects(lifecycle.getMemberAccessProfile(f.db, f.actor, 42), { status: 403, code: 'organization_management_denied' });
    assert.equal(f.state.calls.some(call => call.sql.startsWith('SELECT b.id')), false);
});

test('member directory filters admin self and elevated targets using lifecycle target policy', async () => {
    const f = managementFixture();
    f.state.managerRole = 'admin';
    const directory = await lifecycle.listOrganizationMembers(f.db, f.actor);
    assert.deepEqual(directory.members.map(member => member.id), [42]);
    f.state.targetOrganizationRole = 'owner';
    assert.deepEqual((await lifecycle.listOrganizationMembers(f.db, f.actor)).members, []);
});
