'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLE_HIERARCHY } = require('../config/permissionRegistry');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');
const { canUseParkWorkModule, requireParkWorkModule, loadParkWorkParticipantIds } = require('../services/parkWorkModuleAccess');

function row(role = 'instructor', patch = {}) {
    return { organization_id: 1, business_id: 2, context_key: 'event_genix', access_mode: 'membership',
        role, business_modules: ['training'], is_default: true, ...patch };
}
function actor(role, patch = {}) {
    const account = { id: 11, role };
    const rows = [row(role, patch)];
    return applyMembershipAccess(account, buildMembershipAccess(account, rows, 'event_genix', rows));
}

test('all 26 baseline roles can read the configured Park Training namespace without management grants', () => {
    assert.equal(ROLE_HIERARCHY.length, 26);
    for (const role of ROLE_HIERARCHY) assert.equal(canUseParkWorkModule(actor(role), 'training'), true, role);
    assert.equal(canUseParkWorkModule(actor('instructor'), 'chat'), false, 'unconfigured Chat remains disabled');
    for (const role of ROLE_HIERARCHY) {
        assert.equal(canUseParkWorkModule(actor(role, { business_modules: ['chat', 'training'] }), 'chat'), true, role);
    }
    assert.equal(canUseParkWorkModule(actor('creator'), 'unregistered'), false);
});

test('page denial, missing/disabled module and invalid membership identities fail closed', () => {
    for (const patch of [{ page_denylist: ['/training'] }, { business_modules: [] },
        { business_status: 'inactive' }, { organization_status: 'inactive' }, { access_mode: 'compatibility' }]) {
        assert.equal(canUseParkWorkModule(actor('creator', patch), 'training'), false);
    }
    for (const corrupt of [u => { u.businessMembershipAccess.invalid = true; },
        u => { u.businessMembershipAccess.memberships = []; }, u => { u.activeBusinessMembership = null; },
        u => { u.businessMembershipAccess.registry.push({ ...u.businessMembershipAccess.registry[0] }); }]) {
        const user = actor('creator'); corrupt(user);
        assert.equal(canUseParkWorkModule(user, 'training'), false);
    }
    assert.equal(canUseParkWorkModule(actor('creator'), 'training', 'dar'), false);
});

test('HTTP guard rejects foreign and aggregate scopes, including Creator writes', () => {
    const guard = requireParkWorkModule('training');
    assert.throws(() => requireParkWorkModule('bad'));
    for (const [headers, query, method, expected] of [
        [{ 'x-business-context': 'event_genix' }, {}, 'GET', true],
        [{ 'x-business-context': 'event_genix' }, {}, 'POST', true],
        [{ 'x-business-context': 'dar' }, {}, 'GET', false],
        [{ 'x-business-context': 'event_genix' }, { businessScope: 'all' }, 'GET', false]
    ]) {
        let passed = false; let status;
        guard({ user: actor('creator'), headers, query, body: {}, method },
            { status(value) { status = value; return this; }, json() {} }, () => { passed = true; });
        assert.equal(passed, expected);
        if (!expected) assert.equal(status, 403);
    }
});

test('recipient selection resolves fresh target memberships in two queries, preserves denials and rejects ambiguity', async () => {
    let calls = 0;
    let rows = [row('waiter', { user_id: 11, platform_role: 'waiter' }),
        row('creator', { user_id: 12, platform_role: 'creator', page_denylist: ['/training'] }),
        row('creator', { user_id: 13, platform_role: 'waiter' }),
        row('hr', { user_id: 14, platform_role: 'hr' }), row('hr', { user_id: 14, platform_role: 'hr' })];
    const db = { async query(sql, params) {
        calls++;
        assert.match(sql, /^SELECT /);
        if (calls % 2 === 1) return { rows: [row()] };
        assert.match(sql, /u\.is_active IS TRUE/);
        assert.match(sql, /bm\.is_active IS TRUE/);
        assert.match(sql, /om\.is_active IS TRUE/);
        assert.deepEqual(params, ['event_genix', [11, 12, 13, 14]]);
        return { rows };
    } };
    assert.deepEqual([...await loadParkWorkParticipantIds(db, 'training', [11, 12, 13, 14])], [11]);
    assert.equal(calls, 2);
    rows = [];
    assert.deepEqual([...await loadParkWorkParticipantIds(db, 'training', [11, 12, 13, 14])], []);
    assert.equal(calls, 4, 'no stale eligibility cache');
    await assert.rejects(loadParkWorkParticipantIds(db, 'training', ['11']), TypeError);
    assert.deepEqual([...await loadParkWorkParticipantIds(db, 'training', [])], []);
    assert.equal(calls, 4);
});
