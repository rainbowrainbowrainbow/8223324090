'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyMembershipAccess, buildMembershipAccess, loadMembershipAccess } = require('../services/businessMembership');
const { canAccessBusinessContext, resolveBusinessContextPolicy } = require('../services/businessContext');

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
