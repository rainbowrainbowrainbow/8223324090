'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');

const dbId = require.resolve('../db');
const previousDb = require.cache[dbId];
require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: {
    pool: { query() { throw new Error('Lifecycle audit must use its transaction client'); } }
} };
const lifecycle = require('../services/organizationLifecycle');
after(() => {
    if (previousDb) require.cache[dbId] = previousDb;
    else delete require.cache[dbId];
});

function fixture() {
    const actor = { id: 41, role: 'manager', roles: ['manager'], platformRole: 'manager' };
    const state = {
        calls: [], connects: 0, releases: 0, inTransaction: false, failAudit: false,
        data: {
            organization: { id: 7, status: 'active' },
            users: { 41: { id: 41, role: 'manager', is_active: true }, 52: { id: 52, role: 'manager', is_active: true } },
            organizations: { 41: { role: 'owner', is_active: true }, 52: { role: 'member', is_active: true } },
            businesses: {
                72: { id: 72, organization_id: 7, context_key: 'event_genix', status: 'active' },
                73: { id: 73, organization_id: 7, context_key: 'dar', status: 'active' }
            },
            memberships: {
                '52:72': { role: 'manager', extra_roles: ['accountant'], page_allowlist: ['/timeline'], page_denylist: ['/finance'], action_allowlist: ['create_booking'], action_denylist: ['delete_booking'], is_default: true, is_active: true }
            },
            audits: []
        }
    };
    let snapshot;
    const result = rows => ({ rows: structuredClone(rows), rowCount: rows.length });
    async function query(sql, params = []) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        state.calls.push({ sql: text, params: structuredClone(params), inTransaction: state.inTransaction });
        if (text === 'BEGIN') { snapshot = structuredClone(state.data); state.inTransaction = true; return result([]); }
        if (text === 'COMMIT') { state.inTransaction = false; return result([]); }
        if (text === 'ROLLBACK') { state.data = snapshot; state.inTransaction = false; return result([]); }
        if (text.startsWith('SELECT pg_advisory_xact_lock')) return result([]);
        if (/^(INSERT|UPDATE|DELETE)\b/.test(text)) assert.equal(state.inTransaction, true, text);
        const data = state.data;
        if (text.startsWith('SELECT id, status FROM organizations')) return result(Number(params[0]) === 7 ? [data.organization] : []);
        if (text.startsWith('SELECT om.role, om.is_active, u.is_active AS user_active')) {
            const member = data.organizations[params[1]];
            return result(member ? [{ ...member, user_active: data.users[params[1]]?.is_active === true }] : []);
        }
        if (text.startsWith('SELECT role, is_active FROM users') || text.startsWith('SELECT id, role, is_active FROM users')) {
            return result(data.users[params[0]] ? [data.users[params[0]]] : []);
        }
        if (text.startsWith('SELECT role, is_active FROM organization_memberships')) {
            return result(data.organizations[params[1]] ? [data.organizations[params[1]]] : []);
        }
        if (text.startsWith('SELECT role, extra_roles, page_allowlist')) {
            const membership = data.memberships[`${params[1]}:${params[2]}`];
            return result(membership ? [membership] : []);
        }
        if (text.startsWith('SELECT id FROM businesses')) {
            const business = data.businesses[params[0]];
            return result(business?.organization_id === params[1] && business.status === 'active' ? [business] : []);
        }
        if (text.startsWith('SELECT organization_id FROM businesses')) {
            return result(data.businesses[params[0]] ? [data.businesses[params[0]]] : []);
        }
        if (text.startsWith('SELECT COUNT(*)::int AS count FROM organization_memberships')) {
            return result([{ count: Object.entries(data.organizations).filter(([id, member]) => member.role === 'owner' && member.is_active && data.users[id]?.is_active).length }]);
        }
        if (text.startsWith('INSERT INTO organization_memberships')) {
            data.organizations[params[1]] = { role: params[2], is_active: true };
            return result([]);
        }
        if (text.startsWith('UPDATE business_memberships SET is_default = false')) {
            for (const [key, member] of Object.entries(data.memberships)) {
                if (key.startsWith(`${params[0]}:`) && key !== `${params[0]}:${params[2]}`) member.is_default = false;
            }
            return result([]);
        }
        if (text.startsWith('INSERT INTO business_memberships')) {
            const membership = { role: params[3], extra_roles: params[4], page_allowlist: params[5], page_denylist: params[6], action_allowlist: params[7], action_denylist: params[8], is_default: params[9], is_active: true };
            data.memberships[`${params[2]}:${params[0]}`] = structuredClone(membership);
            return result([{ business_id: params[0], user_id: params[2], role: membership.role, is_default: membership.is_default, is_active: true }]);
        }
        if (text.startsWith('UPDATE business_memberships SET is_active = false')) {
            Object.assign(data.memberships[`${params[1]}:${params[2]}`], { is_active: false, is_default: false });
            return result([]);
        }
        if (text.startsWith('INSERT INTO businesses')) {
            const business = { id: 74, organization_id: params[0], context_key: params[1], label: params[2], short_label: params[3], modules: JSON.parse(params[4]), access_mode: 'membership', status: 'active' };
            data.businesses[74] = business;
            return result([business]);
        }
        if (text.startsWith('UPDATE businesses SET status')) {
            const business = data.businesses[params[1]];
            if (!business || business.organization_id !== params[2]) return result([]);
            business.status = params[0];
            return result([business]);
        }
        if (text.startsWith('INSERT INTO account_security_events')) {
            if (state.failAudit) throw new Error('Lifecycle audit fixture failure');
            data.audits.push({ eventType: params[4], details: JSON.parse(params[6]) });
            return result([]);
        }
        throw new Error(`Unexpected lifecycle fixture SQL: ${text}`);
    }
    const db = { query, async connect() { state.connects += 1; return { query, release() { state.releases += 1; } }; } };
    return { actor, db, state };
}

function writes(state) { return state.calls.filter(call => /^(INSERT|UPDATE|DELETE)\b/.test(call.sql)); }
function assertCommittedAudit(state, eventType) {
    const audit = state.calls.findIndex(call => call.sql.startsWith('INSERT INTO account_security_events'));
    const commit = state.calls.findIndex(call => call.sql === 'COMMIT');
    assert.ok(audit > 0 && commit > audit, 'audit must succeed before commit');
    assert.equal(state.calls[audit].inTransaction, true);
    assert.equal(state.data.audits.at(-1).eventType, eventType);
    assert.equal(state.releases, 1);
    assert.equal(state.calls.some(call => /UPDATE users|refresh_tokens|session_revoked_at/.test(call.sql)), false, 'business lifecycle must not revoke the account session');
}

test('omitted organization role, business role, overrides and default survive membership editing', async () => {
    const { db, actor, state } = fixture();
    state.data.organizations[52].role = 'owner';
    const before = structuredClone(state.data.memberships['52:72']);
    const response = await lifecycle.updateBusinessMembership(db, actor, 7, 52, { businessId: 72 });
    assert.equal(response.role, 'manager');
    assert.deepEqual(state.data.memberships['52:72'], before);
    assert.equal(state.data.organizations[52].role, 'owner');
    assert.match(state.calls[1].sql, /pg_advisory_xact_lock.*organization-ownership/);
    assert.match(state.calls[2].sql, /FROM organizations.*FOR UPDATE/);
    assert.match(state.calls[3].sql, /FROM organization_memberships om JOIN users/);
    assertCommittedAudit(state, 'business_membership_updated');
});

test('explicit empty arrays clear overrides while explicit false clears only the selected default', async () => {
    const { db, actor, state } = fixture();
    const input = { businessId: 72, isDefault: false };
    for (const field of ['extraRoles', 'pageAllowlist', 'pageDenylist', 'actionAllowlist', 'actionDenylist']) input[field] = [];
    await lifecycle.updateBusinessMembership(db, actor, 7, 52, input);
    const member = state.data.memberships['52:72'];
    for (const field of ['extra_roles', 'page_allowlist', 'page_denylist', 'action_allowlist', 'action_denylist']) assert.deepEqual(member[field], []);
    assert.equal(member.is_default, false);
    assert.equal(state.calls.some(call => call.sql.startsWith('UPDATE business_memberships SET is_default')), false);
});

test('switching a default clears another membership of the same user inside the transaction', async () => {
    const { db, actor, state } = fixture();
    state.data.memberships['52:73'] = { ...structuredClone(state.data.memberships['52:72']), is_default: false };
    await lifecycle.updateBusinessMembership(db, actor, 7, 52, { businessId: 73, isDefault: true });
    assert.equal(state.data.memberships['52:72'].is_default, false);
    assert.equal(state.data.memberships['52:73'].is_default, true);
    const clear = state.calls.find(call => call.sql.startsWith('UPDATE business_memberships SET is_default'));
    assert.deepEqual(clear.params, [52, 7, 73]);
    assertCommittedAudit(state, 'business_membership_updated');
});

test('invalid array, default and creator inputs fail before any transaction or write', async () => {
    for (const invalid of [
        { isDefault: 'true' }, { isDefault: null }, { extraRoles: 'manager' }, { extraRoles: [7] },
        { extraRoles: ['creator'] }, { extraRoles: ['unknown_role'] }, { role: 'creator' },
        { pageAllowlist: null }, { pageDenylist: {} }, { actionAllowlist: ['create_booking', null] }, { actionDenylist: false }
    ]) {
        const { db, actor, state } = fixture();
        await assert.rejects(lifecycle.updateBusinessMembership(db, actor, 7, 52, { businessId: 72, ...invalid }), { status: 400, code: 'business_membership_invalid' });
        assert.equal(state.connects, 0, JSON.stringify(invalid));
        assert.deepEqual(writes(state), []);
    }
});

test('administrator manages another ordinary member but cannot modify self, elevated peers or promote', async () => {
    const good = fixture();
    good.state.data.organizations[41].role = 'admin';
    await lifecycle.updateBusinessMembership(good.db, good.actor, 7, 52, { businessId: 72, role: 'animator' });
    assert.equal(good.state.data.memberships['52:72'].role, 'animator');
    for (const scenario of [{ targetRole: 'owner' }, { targetRole: 'admin' }, { targetId: 41 }, { nextRole: 'owner' }, { nextRole: 'admin' }, { accountRole: 'creator' }]) {
        const { db, actor, state } = fixture();
        state.data.organizations[41].role = 'admin';
        if (scenario.targetRole) state.data.organizations[52].role = scenario.targetRole;
        if (scenario.accountRole) state.data.users[52].role = scenario.accountRole;
        const input = { businessId: 72, role: 'animator', ...(scenario.nextRole ? { organizationRole: scenario.nextRole } : {}) };
        await assert.rejects(lifecycle.updateBusinessMembership(db, actor, 7, scenario.targetId || 52, input), { status: 403, code: 'organization_management_denied' });
        assert.deepEqual(writes(state), [], JSON.stringify(scenario));
    }
});

test('fresh inactive or removed organization membership defeats stale owner identity', async () => {
    for (const membership of [null, { role: 'owner', is_active: false }]) {
        const { db, actor, state } = fixture();
        actor.organizationRole = 'owner';
        state.data.organizations[41] = membership;
        await assert.rejects(lifecycle.updateBusinessMembership(db, actor, 7, 52, { businessId: 72, role: 'animator' }), { status: 403, code: 'organization_management_denied' });
        assert.deepEqual(writes(state), []);
    }
});

test('temporary QA creator authority cannot bypass foreign organization ownership', async () => {
    const { db, actor, state } = fixture();
    Object.assign(actor, {
        role: 'creator', roles: ['creator'], platformRole: 'creator',
        qaCreatorLeaseId: '11111111-1111-4111-8111-111111111111'
    });
    delete state.data.organizations[41];
    await assert.rejects(lifecycle.updateBusinessMembership(db, actor, 7, 52, { businessId: 72, role: 'animator' }), { status: 403, code: 'organization_management_denied' });
    assert.equal(state.calls.some(call => call.sql.startsWith('SELECT role, is_active FROM users')), true);
    assert.deepEqual(writes(state), []);
    assert.deepEqual(state.data.audits, []);
});

test('last owner cannot self-demote, but a second active owner allows an explicit demotion', async () => {
    for (const secondOwner of [false, true]) {
        const { db, actor, state } = fixture();
        actor.id = 52;
        state.data.organizations[52].role = 'owner';
        state.data.organizations[41].role = secondOwner ? 'owner' : 'member';
        const operation = lifecycle.updateBusinessMembership(db, actor, 7, 52, { businessId: 72, organizationRole: 'member' });
        if (secondOwner) {
            await operation;
            assert.equal(state.data.organizations[52].role, 'member');
        } else {
            await assert.rejects(operation, { status: 409, code: 'organization_last_owner' });
            assert.deepEqual(writes(state), []);
            assert.equal(state.data.organizations[52].role, 'owner');
        }
    }
});

test('business creation and status changes are owner-only and strictly audited', async () => {
    for (const [eventType, operation] of [
        ['business_created', f => lifecycle.createBusiness(f.db, f.actor, 7, { contextKey: 'fixture_company', label: 'Fixture company', modules: ['tasks'] })],
        ['business_status_changed', f => lifecycle.setBusinessStatus(f.db, f.actor, 72, 'inactive')]
    ]) {
        const owner = fixture();
        await operation(owner);
        assertCommittedAudit(owner.state, eventType);
        const admin = fixture();
        admin.state.data.organizations[41].role = 'admin';
        await assert.rejects(operation(admin), { status: 403, code: 'organization_management_denied' });
        assert.deepEqual(writes(admin.state), []);
    }
});

test('owners cannot claim legacy business partitions or aggregate aliases as new businesses', async () => {
    for (const contextKey of ['event_genix', 'dar', 'crm', 'maysternya_doli', 'park', 'md', 'all', 'all_business', 'overview', 'multi', 'many', 'selected', 'several']) {
        const { db, actor, state } = fixture();
        await assert.rejects(lifecycle.createBusiness(db, actor, 7, { contextKey, label: 'Fixture company' }), { status: 400, code: 'business_invalid' });
        assert.equal(state.connects, 0, contextKey);
        assert.deepEqual(writes(state), []);
    }
});

test('strict audit failure rolls back each lifecycle mutation and releases the transaction', async () => {
    for (const operation of [
        f => lifecycle.updateBusinessMembership(f.db, f.actor, 7, 52, { businessId: 72, role: 'animator', organizationRole: 'admin', isDefault: false }),
        f => lifecycle.deactivateBusinessMembership(f.db, f.actor, 7, 52, 72),
        f => lifecycle.createBusiness(f.db, f.actor, 7, { contextKey: 'fixture_company', label: 'Fixture company' }),
        f => lifecycle.setBusinessStatus(f.db, f.actor, 72, 'inactive')
    ]) {
        const f = fixture();
        f.state.failAudit = true;
        const before = structuredClone(f.state.data);
        await assert.rejects(operation(f), /Lifecycle audit fixture failure/);
        assert.deepEqual(f.state.data, before);
        assert.equal(f.state.calls.some(call => call.sql === 'COMMIT'), false);
        assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK');
        assert.equal(f.state.releases, 1);
    }
});

test('repeated business membership deactivation preserves organization ownership and account sessions', async () => {
    const { db, actor, state } = fixture();
    state.data.organizations[52].role = 'owner';
    await lifecycle.deactivateBusinessMembership(db, actor, 7, 52, 72);
    assert.equal(state.data.memberships['52:72'].is_active, false);
    assert.equal(state.data.memberships['52:72'].is_default, false);
    assert.equal(state.data.organizations[52].role, 'owner');
    assertCommittedAudit(state, 'business_membership_deactivated');
    await lifecycle.deactivateBusinessMembership(db, actor, 7, 52, 72);
    assert.equal(state.data.audits[1].details.wasActive, false);
    assert.equal(state.data.audits[1].details.sessionsRevoked, false);
    assert.equal(state.calls.some(call => /UPDATE users|refresh_tokens|session_revoked_at/.test(call.sql)), false);
});
