'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyMembershipAccess, buildMembershipAccess, loadMembershipAccess } = require('../services/businessMembership');
const { canAccessBusinessContext, resolveBusinessContextPolicy, resolveBusinessScope } = require('../services/businessContext');
const { normalizeRoleList, resolveCapability } = require('../services/accountAccessPolicy');

function membership(overrides = {}) {
    return {
        organization_id: 7,
        organization_slug: 'eventgenix-group',
        organization_name: 'Event Genix Group',
        organization_role: 'owner',
        business_id: 11,
        context_key: 'event_genix',
        business_label: 'Парк Закревського',
        business_short_label: 'Парк',
        business_modules: ['dashboard', 'timeline'],
        access_mode: 'membership',
        role: 'manager',
        extra_roles: ['accountant'],
        page_allowlist: [],
        page_denylist: [],
        action_allowlist: [],
        action_denylist: [],
        is_default: true,
        ...overrides
    };
}

test('membership access replaces the active business role without changing account identity', () => {
    const access = buildMembershipAccess({ id: 42 }, [
        membership(),
        membership({ business_id: 12, context_key: 'dar', business_label: 'Дар', business_short_label: 'Дар', role: 'accountant', is_default: false })
    ], 'dar');
    const user = applyMembershipAccess({ id: 42, username: 'operator', role: 'creator' }, access);

    assert.equal(access.membershipEnabled, true);
    assert.equal(user.id, 42);
    assert.equal(user.role, 'accountant');
    assert.deepEqual(user.businessContexts.sort(), ['dar', 'event_genix']);
    assert.equal(user.activeBusinessMembership.businessContext, 'dar');
    assert.equal(canAccessBusinessContext(user, 'event_genix'), true);
    assert.equal(canAccessBusinessContext(user, 'dar'), true);
});

test('a migrated membership does not block an unmigrated compatibility context', () => {
    const access = buildMembershipAccess({ id: 42 }, [membership()], 'maysternya_doli');
    const user = applyMembershipAccess({ id: 42, role: 'creator', business_contexts: ['event_genix', 'maysternya_doli'] }, access);

    assert.equal(access.membershipEnabled, false);
    assert.equal(user.role, 'creator');
    assert.equal(resolveBusinessContextPolicy(user).allowed.includes('maysternya_doli'), true);
});

test('self-contained test doubles retain the legacy compatibility path', async () => {
    const access = await loadMembershipAccess({
        query() {
            throw new Error('Unexpected test-double query: membership resolver is outside this mock contract');
        }
    }, { id: 42 }, 'event_genix');

    assert.equal(access.configured, false);
    assert.equal(access.testDoubleUnavailable, true);
});

test('SQL-in-test sentinels retain the legacy compatibility path', async () => {
    const access = await loadMembershipAccess({
        query() {
            throw new Error('Unexpected SQL in auth lifecycle test: membership resolver is outside this mock contract');
        }
    }, { id: 42 }, 'event_genix');

    assert.equal(access.configured, false);
    assert.equal(access.testDoubleUnavailable, true);
});

test('organization migration creates an additive membership schema and scoped default uniqueness', () => {
    const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '357_organizations_business_memberships.sql'), 'utf8');
    assert.match(migration, /CREATE TABLE IF NOT EXISTS organizations/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS businesses/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS organization_memberships/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS business_memberships/);
    assert.match(migration, /ON business_memberships \(user_id, organization_id\)/);
    assert.match(migration, /Business membership organization does not match business/);
});

function registry(overrides = {}) {
    return {
        business_id: 11,
        organization_id: 7,
        context_key: 'event_genix',
        access_mode: 'membership',
        business_status: 'active',
        organization_status: 'active',
        ...overrides
    };
}

const migratedRegistry = [registry(), registry({ business_id: 12, context_key: 'dar' })];

test('a migrated registry with zero memberships never restores legacy Park or Dar access', () => {
    const account = { id: 42, role: 'director', business_contexts: ['event_genix', 'dar'] };
    for (const context of ['event_genix', 'dar']) {
        const user = applyMembershipAccess(account, buildMembershipAccess(account, [], context, migratedRegistry));
        assert.equal(canAccessBusinessContext(user, context), false, context);
        assert.equal(resolveBusinessScope({ user, query: { businessContext: context } }).invalid, true);
    }
    const user = applyMembershipAccess(account, buildMembershipAccess(account, [], null, migratedRegistry));
    assert.deepEqual(resolveBusinessContextPolicy(user).allowed, []);
    assert.equal(resolveBusinessScope({ user, query: {} }).invalid, true);
});

test('missing Dar membership is denied despite a legacy Dar assignment and active Park membership', () => {
    const account = { id: 42, role: 'director', business_contexts: ['event_genix', 'dar'] };
    const user = applyMembershipAccess(account, buildMembershipAccess(account, [membership()], 'dar', migratedRegistry));
    assert.equal(canAccessBusinessContext(user, 'dar'), false);
    assert.equal(resolveBusinessScope({ user, query: { businessContext: 'dar' } }).invalid, true);
});

test('Dar-only and custom-only low roles keep their own business and never inherit Park', () => {
    for (const context of ['dar', 'qa_membership_cabinet']) {
        const account = { id: 42, role: 'manager', business_contexts: ['event_genix'] };
        const rows = [membership({ context_key: context, role: 'animator', extra_roles: [] })];
        const user = applyMembershipAccess(account, buildMembershipAccess(account, rows, null, [registry({ context_key: context })]));
        const policy = resolveBusinessContextPolicy(user);
        assert.deepEqual(policy.allowed, [context]);
        assert.equal(policy.defaultContext, context);
        assert.equal(canAccessBusinessContext(user, context), true);
        assert.equal(canAccessBusinessContext(user, 'event_genix'), false);
        assert.equal(resolveBusinessScope({ user, query: {} }).activeContext, context);
    }
});

test('membership roles and overrides replace every stale account payload alias', () => {
    const account = {
        id: 42,
        role: 'director',
        roles: ['director', 'accountant'],
        extra_roles: ['creator'],
        extraRoles: ['creator'],
        page_allowlist: ['/finance'],
        pageAllowlist: ['/finance'],
        page_denylist: ['/timeline'],
        pageDenylist: ['/timeline'],
        action_allowlist: ['manage_accounts'],
        actionAllowlist: ['manage_accounts'],
        action_denylist: ['create_booking'],
        actionDenylist: ['create_booking']
    };
    const rows = [membership({ role: 'animator', extra_roles: [] })];
    const user = applyMembershipAccess(account, buildMembershipAccess(account, rows, 'event_genix', migratedRegistry));
    assert.equal(user.role, 'animator');
    assert.deepEqual(normalizeRoleList(user), ['animator']);
    for (const field of ['extraRoles', 'extra_roles', 'pageAllowlist', 'page_allowlist', 'pageDenylist', 'page_denylist', 'actionAllowlist', 'action_allowlist', 'actionDenylist', 'action_denylist']) {
        assert.deepEqual(user[field], [], field);
    }
    assert.equal(resolveCapability(user, '/finance', { type: 'page' }).allowed, false);
});

test('an omitted request context uses the same membership for role and data scope', () => {
    const account = { id: 42, role: 'director', business_contexts: ['event_genix', 'dar'], default_business_context: 'event_genix' };
    const rows = [membership({ role: 'animator', is_default: false }), membership({ business_id: 12, context_key: 'dar', role: 'accountant', is_default: true })];
    const user = applyMembershipAccess(account, buildMembershipAccess(account, rows, null, migratedRegistry));
    assert.equal(user.role, 'accountant');
    assert.equal(user.activeBusinessMembership.businessContext, 'dar');
    assert.equal(resolveBusinessScope({ user, query: {} }).activeContext, 'dar');
    assert.equal(resolveBusinessScope({ user, query: { businessContext: 'event_genix' } }).activeContext, 'event_genix');
});

test('aggregate selection rejects multiple organizations but permits an explicit same-organization subset', () => {
    const account = { id: 42, role: 'director' };
    const rows = [
        membership(),
        membership({ business_id: 12, context_key: 'dar', is_default: false }),
        membership({ organization_id: 8, business_id: 13, context_key: 'qa_other_org', is_default: false })
    ];
    const user = applyMembershipAccess(account, buildMembershipAccess(account, rows, 'event_genix', [
        ...migratedRegistry, registry({ organization_id: 8, business_id: 13, context_key: 'qa_other_org' })
    ]));
    for (const query of [
        { businessScope: 'all' },
        { businessScope: 'multi', businessContexts: 'event_genix,qa_other_org' }
    ]) {
        assert.equal(resolveBusinessScope({ user, query }).invalid, true, JSON.stringify(query));
    }
    const scope = resolveBusinessScope({ user, query: { businessScope: 'multi', businessContexts: 'event_genix,dar' } });
    assert.equal(scope.invalid, false);
    assert.equal(scope.readOnly, true);
    assert.equal(scope.canWrite, false);
    assert.deepEqual(scope.selectedContexts, ['event_genix', 'dar']);
});

test('same-organization all-business scope remains available and read-only', () => {
    const account = { id: 42, role: 'manager' };
    const user = applyMembershipAccess(account, buildMembershipAccess(account, [
        membership(), membership({ business_id: 12, context_key: 'dar', is_default: false })
    ], 'event_genix', migratedRegistry));
    const scope = resolveBusinessScope({ user, headers: { 'x-business-scope': 'all' } });
    assert.equal(scope.invalid, false);
    assert.equal(scope.readOnly, true);
    assert.equal(scope.canWrite, false);
    assert.deepEqual(scope.selectedContexts, ['event_genix', 'dar']);
});

test('same-organization aggregate reads cannot borrow another business role or override', () => {
    const account = { id: 42, role: 'director' };
    for (const darOverride of [
        { role: 'animator' },
        { extra_roles: ['director'] },
        { page_allowlist: ['/finance'] },
        { page_denylist: ['/finance'] },
        { action_allowlist: ['create_booking'] },
        { action_denylist: ['create_booking'] }
    ]) {
        const rows = [
            membership({ role: 'accountant', extra_roles: [] }),
            membership({ business_id: 12, context_key: 'dar', role: 'accountant', extra_roles: [], is_default: false, ...darOverride })
        ];
        const user = applyMembershipAccess(account, buildMembershipAccess(account, rows, 'event_genix', migratedRegistry));
        const scope = resolveBusinessScope({ user, query: { businessScope: 'multi', businessContexts: 'event_genix,dar' } });
        assert.equal(scope.invalid, true, JSON.stringify(darOverride));
        assert.equal(scope.reason, 'business_scope_permissions_mismatch');
    }
});
