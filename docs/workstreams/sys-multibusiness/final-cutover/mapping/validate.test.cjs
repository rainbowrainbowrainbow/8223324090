'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('./validate.cjs');
const template = require('./crm.template.json');
const copy = value => JSON.parse(JSON.stringify(value));
function complete() {
    const input = copy(template);
    input.collectionStatus = 'COMPLETE';
    input.source = { deploymentSha: 'a'.repeat(40), snapshotAtUtc: '2026-09-12T00:00:00Z',
        snapshotSha256: 'b'.repeat(64), effectiveAccessMatrixSha256: 'c'.repeat(64) };
    input.target.organizationId = 1; input.target.businessId = 2;
    input.memberships = [{ userId: 10, organizationId: 1, businessId: 2, sourceUserFingerprint: 'd'.repeat(64),
        driftPolicy: 'ABORT', unchangedOutsideTarget: true, sourceOrganizationRole: 'member', sourceUserActive: true,
        before: { contextAccessible: true, allowedSurfaces: ['GET:/api/leads:own_business'] },
        after: { contextAccessible: true, allowedSurfaces: ['GET:/api/leads:own_business'] },
        desired: { role: 'director', extraRoles: [], organizationRole: 'member', isActive: true, isDefault: false,
            pageAllowlist: [], pageDenylist: [], actionAllowlist: [], actionDenylist: [] } }];
    return input;
}
test('both unpopulated templates remain review-only HOLD', () => {
    for (const context of ['crm', 'maysternya_doli']) {
        const result = validate(require('./' + context + '.template.json'));
        assert.equal(result.formatValid, true);
        assert.equal(result.safeToApply, false);
        assert.ok(result.blockers.includes('REAL_SOURCE_NOT_FULLY_COLLECTED'));
    }
});
test('foreign business and repeated user mapping are rejected', () => {
    const input = complete(); input.memberships[0].businessId = 99;
    input.memberships.push(copy(input.memberships[0]));
    const result = validate(input);
    assert.ok(result.errors.some(error => error.code === 'TARGET_MISMATCH'));
    assert.ok(result.errors.some(error => error.code === 'INVALID_OR_DUPLICATE_USER'));
});
test('raw context strings cannot grant previously inaccessible context or operation', () => {
    const input = complete(); input.memberships[0].before.contextAccessible = false;
    input.memberships[0].after.allowedSurfaces.push('POST:/api/tasks:own_business');
    assert.ok(validate(input).errors.some(error => error.code === 'ACCESS_EXPANSION_FORBIDDEN'));
});
test('platform creator and organization promotion are not inferred by mapping', () => {
    const input = complete(); input.memberships[0].desired.role = 'creator';
    input.memberships[0].desired.organizationRole = 'owner';
    const result = validate(input);
    assert.ok(result.errors.some(error => error.code === 'INVALID_MEMBERSHIP_PROPOSAL'));
    assert.ok(result.errors.some(error => error.code === 'ORGANIZATION_PRIVILEGE_EXPANSION_FORBIDDEN'));
});
test('loss of existing permissions needs an explicit restriction decision', () => {
    const input = complete(); input.memberships[0].after.allowedSurfaces = [];
    assert.ok(validate(input).errors.some(error => error.code === 'RESTRICTION_DECISION_REQUIRED'));
});
test('inactive users and changed defaults are not silently repaired', () => {
    const input = complete(); input.memberships[0].sourceUserActive = false;
    input.defaults.push({ userId: 10, beforeContext: 'dar', afterContext: 'crm', unchangedOutsideTarget: true });
    const result = validate(input);
    assert.ok(result.errors.some(error => error.code === 'ACCOUNT_REACTIVATION_FORBIDDEN'));
    assert.ok(result.errors.some(error => error.code === 'DEFAULT_CHANGE_REQUIRES_SEPARATE_REVIEW'));
});
test('even apparently approved complete metadata never authorizes migration', () => {
    const input = complete();
    input.approval = { status: 'APPROVED', reference: 'synthetic-review', mappingSha256: 'e'.repeat(64) };
    const result = validate(input);
    assert.equal(result.formatValid, true);
    assert.equal(result.authorizationVerified, false);
    assert.equal(result.readyForMigration, false);
    assert.equal(result.safeToApply, false);
});
test('partial input, unknown context and missing source fingerprint fail closed', () => {
    const input = complete(); input.businessContext = 'unreviewed';
    delete input.source.snapshotSha256; input.memberships[0].sourceUserFingerprint = null;
    assert.equal(validate(input).formatValid, false);
});

test('unknown nested fields are rejected at every review boundary', () => {
    for (const field of ['source', 'target', 'approval', 'historicalOwnerMapping']) {
        const input = complete(); input[field].unsafeExtra = true;
        assert.equal(validate(input).formatValid, false, field);
    }
    for (const field of [null, 'before', 'after', 'desired']) {
        const input = complete();
        (field ? input.memberships[0][field] : input.memberships[0]).unsafeExtra = true;
        assert.equal(validate(input).formatValid, false, String(field));
    }
});
test('unknown roles, modules and page/action identifiers are not valid mapping fields', () => {
    const mutations = [
        input => { input.memberships[0].desired.role = 'made_up_role'; },
        input => { input.memberships[0].desired.extraRoles = ['not_a_role']; },
        input => { input.target.modules = ['not_a_module']; },
        input => { input.memberships[0].desired.pageAllowlist = ['not_a_page']; },
        input => { input.memberships[0].desired.actionDenylist = ['not_an_action']; },
        input => { input.memberships[0].desired.role = ' creator '; },
        input => { input.memberships[0].before.allowedSurfaces = [' ']; }
    ];
    for (const mutate of mutations) {
        const input = complete(); mutate(input); assert.equal(validate(input).formatValid, false);
    }
});
test('source active state and organization role must be explicitly typed', () => {
    for (const field of ['sourceUserActive', 'sourceOrganizationRole']) {
        const input = complete(); delete input.memberships[0][field];
        assert.equal(validate(input).formatValid, false, field);
    }
    for (const value of [null, 'false', 0]) {
        const input = complete(); input.memberships[0].sourceUserActive = value;
        assert.equal(validate(input).formatValid, false);
    }
    const input = complete(); input.memberships[0].sourceOrganizationRole = 'creator';
    assert.equal(validate(input).formatValid, false);
});
test('context-access loss needs a nonempty typed restriction reference', () => {
    const input = complete();
    input.memberships[0].before.allowedSurfaces = [];
    input.memberships[0].after = { contextAccessible: false, allowedSurfaces: [] };
    for (const reference of [undefined, null, '', true, {}]) {
        if (reference === undefined) delete input.memberships[0].approvedRestrictionRef;
        else input.memberships[0].approvedRestrictionRef = reference;
        assert.equal(validate(input).formatValid, false);
    }
    input.memberships[0].approvedRestrictionRef = 'synthetic-reviewed-restriction';
    assert.equal(validate(input).formatValid, true);
});
test('default rows require exact fields and canonical context keys', () => {
    for (const row of [
        { userId: 10, unchangedOutsideTarget: true },
        { userId: 10, beforeContext: '', afterContext: '', unchangedOutsideTarget: true },
        { userId: 10, beforeContext: 'md', afterContext: 'md', unchangedOutsideTarget: true },
        { userId: 10, beforeContext: 'all', afterContext: 'all', unchangedOutsideTarget: true },
        { userId: 10, beforeContext: 'dar', afterContext: 'dar', unchangedOutsideTarget: true, unsafeExtra: true }
    ]) {
        const input = complete(); input.defaults = [row];
        assert.equal(validate(input).formatValid, false);
    }
});
test('duplicate default rows cannot make conflicting claims for one user', () => {
    const input = complete();
    input.defaults = ['dar', 'crm'].map(context => ({ userId: 10, beforeContext: context,
        afterContext: context, unchangedOutsideTarget: true }));
    assert.equal(validate(input).formatValid, false);
    input.defaults[1] = copy(input.defaults[0]);
    assert.equal(validate(input).formatValid, false);
});
test('claimed default membership requires matching default evidence and active state', () => {
    const input = complete(); input.memberships[0].desired.isDefault = true;
    assert.equal(validate(input).formatValid, false);
    input.defaults = [{ userId: 10, beforeContext: 'crm', afterContext: 'crm', unchangedOutsideTarget: true }];
    assert.equal(validate(input).formatValid, true);
    input.memberships[0].desired.isDefault = false;
    assert.equal(validate(input).formatValid, false);
    input.memberships[0].desired.isDefault = true; input.memberships[0].desired.isActive = false;
    assert.equal(validate(input).formatValid, false);
});
test('snapshot timestamps must be real UTC calendar instants', () => {
    for (const value of ['2026-02-30', '2026-02-30T00:00:00Z', '2026-09-12',
        '2026-09-12T00:00:00+03:00', '2026-09-12T24:00:00Z', '2026-13-01T00:00:00Z']) {
        const input = complete(); input.source.snapshotAtUtc = value;
        assert.equal(validate(input).formatValid, false, value);
    }
});
test('historical mapping and approval metadata cannot have invalid nested types', () => {
    for (const field of ['source', 'target', 'approval', 'historicalOwnerMapping']) {
        for (const value of [42, [], null]) {
            const input = complete(); input[field] = value;
            assert.equal(validate(input).formatValid, false, field);
        }
    }
    const input = complete(); input.historicalOwnerMapping.decisionsStatus = 'READY';
    assert.equal(validate(input).formatValid, false);
});
test('valid canonical values, explicit absent defaults and leap dates remain review-only', () => {
    const input = complete(); input.source.snapshotAtUtc = '2024-02-29T12:34:56.123Z';
    input.target.modules = ['leads', 'tasks'];
    input.memberships[0].sourceOrganizationRole = null;
    input.memberships[0].desired.extraRoles = ['manager'];
    input.memberships[0].desired.pageAllowlist = ['/sales-funnel'];
    input.memberships[0].desired.actionDenylist = ['manage_accounts'];
    input.defaults = [{ userId: 10, beforeContext: null, afterContext: null, unchangedOutsideTarget: true }];
    let result = validate(input);
    assert.equal(result.formatValid, true);
    assert.equal(result.readyForMigration, false); assert.equal(result.authorizationVerified, false);
    assert.equal(result.safeToApply, false);
    input.defaults[0].beforeContext = 'synthetic_other'; input.defaults[0].afterContext = 'synthetic_other';
    result = validate(input); assert.equal(result.formatValid, true); assert.equal(result.safeToApply, false);
});
test('pure registry imports do not load database, application startup or providers', () => {
    const loaded = Object.keys(require.cache).map(file => file.replaceAll('\\', '/'));
    assert.equal(loaded.some(file => /\/(?:db\/index|server|services\/telegram|middleware\/auth)\.js$/.test(file)), false);
});
