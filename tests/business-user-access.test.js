'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { businessUserAccessSql } = require('../services/businessUserAccess');

function actor() {
    return { id: 5, role: 'manager', activeBusinessMembership: { businessId: 2, organizationId: 1, businessContext: 'dar' },
        businessMembershipAccess: { configured: true, membershipEnabled: true, registry: [
            { businessContext: 'dar', accessMode: 'membership' }
        ] } };
}

test('candidate access uses parameterized active business and organization, not the legacy mirror', () => {
    const params = [9];
    const value = businessUserAccessSql(actor(), params, 'u');
    assert.deepEqual(params, [9, 2, 1]);
    assert.equal(value.membershipMode, true);
    assert.match(value.condition, /candidate_bm.business_id = \$2/);
    assert.match(value.condition, /candidate_bm.organization_id = \$3/);
    assert.match(value.condition, /candidate_bm.user_id = u.id/);
    assert.match(value.roleSql, /SELECT candidate_bm.role/);
    assert.match(value.extraRolesSql, /SELECT candidate_bm.extra_roles/);
    assert.doesNotMatch(value.condition, /business_contexts/);
});

test('candidate SQL requires active organization, business and both memberships', () => {
    const value = businessUserAccessSql(actor(), []);
    for (const source of ['candidate_b', 'candidate_o']) assert.ok(value.condition.includes(`${source}.status = 'active'`));
    for (const source of ['candidate_bm', 'candidate_om']) assert.ok(value.condition.includes(`${source}.is_active IS TRUE`));
    assert.match(value.condition, /candidate_bm.role <> 'creator' OR users.role = 'creator'/);
});

test('invalid or missing active membership never restores global candidate access', () => {
    for (const value of [
        { ...actor(), activeBusinessMembership: null },
        { ...actor(), businessMembershipAccess: { ...actor().businessMembershipAccess, invalid: true } }
    ]) assert.equal(businessUserAccessSql(value, []).condition, 'AND FALSE');
});

test('a different business cannot borrow the actor membership role', () => {
    assert.equal(businessUserAccessSql(actor(), [], 'u', 'event_genix').condition, 'AND FALSE');
    assert.equal(businessUserAccessSql(actor(), [], 'u', { activeContext: 'dar', invalid: true }).condition, 'AND FALSE');
});

test('compatibility actors cannot select a registry business without active membership', () => {
    const user = actor();
    user.activeBusinessMembership = null;
    user.businessMembershipAccess.membershipEnabled = false;
    assert.equal(businessUserAccessSql(user, [], 'u', 'dar').condition, 'AND FALSE');
});

test('legacy internal and compatible paths retain their existing role policy', () => {
    for (const user of [undefined, { role: 'manager' }, { role: 'creator', businessContexts: ['crm'], businessMembershipAccess: { configured: true, membershipEnabled: false } }]) {
        assert.deepEqual(businessUserAccessSql(user, [], 'u', 'crm'), {
            condition: '', roleSql: 'u.role', extraRolesSql: 'u.extra_roles', membershipMode: false
        });
    }
});

test('a compatibility actor cannot supply an inaccessible context absent from its registry snapshot', () => {
    const user = { role: 'creator', businessContexts: ['maysternya_doli', 'crm'],
        businessMembershipAccess: { configured: true, membershipEnabled: false, memberships: [], registry: [
            { businessContext: 'event_genix', accessMode: 'membership', active: true }
        ] } };
    assert.equal(businessUserAccessSql(user, [], 'users', 'dar').condition, 'AND FALSE');
    for (const context of ['maysternya_doli', 'crm']) {
        assert.equal(businessUserAccessSql(user, [], 'users', context).condition, '');
    }
});

test('SQL aliases cannot supply expressions or SQL fragments', () => {
    assert.throws(() => businessUserAccessSql(actor(), [], 'u; SELECT 1'), /Invalid user SQL alias/);
});
