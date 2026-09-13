'use strict';

const assert = require('node:assert/strict');
const { after, before, beforeEach, test } = require('node:test');
const express = require('express');

let server;
let baseUrl;
let state;
const previousJwtSecret = process.env.JWT_SECRET;
const savedModules = new Map();

function replaceModule(name, exports) {
    const id = require.resolve(name);
    savedModules.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function resetState() {
    state = {
        user: { id: 41, role: 'manager', platformRole: 'manager' },
        accountRole: 'manager',
        organizationMembership: { role: 'owner', is_active: true },
        queries: [],
        events: [],
        connects: 0,
        releases: 0
    };
}

async function query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    state.queries.push({ sql: normalized, params });
    if (normalized.startsWith('SELECT id, status FROM organizations')) return { rows: [{ id: params[0], status: 'active' }] };
    if (normalized.startsWith('SELECT om.role, om.is_active, u.is_active AS user_active')) {
        return { rows: state.organizationMembership ? [{ ...state.organizationMembership, user_active: true }] : [] };
    }
    if (normalized.startsWith('SELECT role, is_active FROM users')) return { rows: [{ role: state.accountRole, is_active: true }] };
    if (normalized.startsWith('SELECT id, role, is_active FROM users')) return { rows: [{ id: params[0], role: 'manager', is_active: true }] };
    if (normalized.startsWith('SELECT role, is_active FROM organization_memberships')) return { rows: [{ role: 'member', is_active: true }] };
    if (normalized.startsWith('SELECT role, extra_roles, page_allowlist')) return { rows: [] };
    if (normalized.startsWith('SELECT id FROM businesses WHERE')) return { rows: [{ id: 72 }] };
    if (normalized.startsWith('SELECT organization_id FROM businesses WHERE')) return { rows: [{ organization_id: 7 }] };
    if (normalized.startsWith('SELECT id FROM organizations LIMIT 1')) return { rows: [{ id: 7 }] };
    if (normalized.startsWith('UPDATE businesses SET status')) {
        return { rows: [{ id: params[1], context_key: 'dar', status: params[0] }] };
    }
    if (normalized.startsWith('INSERT INTO business_memberships')) {
        return { rows: [{ business_id: params[0], user_id: params[2], role: params[3], is_default: params[9], is_active: true }] };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(normalized)
        || normalized.startsWith('INSERT INTO organization_memberships')
        || normalized.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
    throw new Error(`Unexpected organization guard test query: ${normalized}`);
}

function writes() {
    return state.queries.filter(item => /^(INSERT|UPDATE|DELETE)\b/.test(item.sql));
}

async function request(method, route, body) {
    const response = await fetch(`${baseUrl}/api/organizations${route}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
}

before(async () => {
    resetState();
    process.env.JWT_SECRET = 'organization-guard-unit-test-only';
    replaceModule('../db', {
        pool: {
            query,
            async connect() {
                state.connects += 1;
                return { query, release() { state.releases += 1; } };
            }
        }
    });
    replaceModule('../services/accountSecurity', {
        async recordAccountSecurityEvent(event) {
            assert.equal(event.strict, true);
            assert.equal(typeof event.client?.query, 'function');
            state.events.push(event);
        }
    });
    for (const name of ['../middleware/auth', '../services/organizationLifecycle', '../routes/organizations']) {
        const id = require.resolve(name);
        savedModules.set(id, require.cache[id]);
        delete require.cache[id];
    }
    const app = express();
    app.use(express.json());
    // Authentication/resolver behavior is covered separately. These route tests
    // exercise the actual lifecycle guards and capability policy after auth.
    app.use((req, res, next) => { req.user = state.user; next(); });
    app.use('/api/organizations', require('../routes/organizations'));
    await new Promise(resolve => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(resetState);

after(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    for (const [id, previous] of savedModules) {
        if (previous) require.cache[id] = previous;
        else delete require.cache[id];
    }
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
});

test('a business creator cannot manage a foreign organization without a platform role', async () => {
    state.user = { id: 41, role: 'creator', platformRole: 'manager' };
    state.organizationMembership = null;
    const response = await request('PUT', '/8/members/52', { businessId: 72, role: 'animator' });

    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'organization_management_denied');
    const membershipRead = state.queries.find(item => item.sql.startsWith('SELECT om.role'));
    assert.deepEqual(membershipRead.params, [8, 41]);
    assert.equal(state.connects, 1);
    assert.deepEqual(writes(), []);
});

test('missing platformRole never falls back to a creator business role', async () => {
    state.user = { id: 41, role: 'creator' };
    state.organizationMembership = null;
    const response = await request('PUT', '/8/members/52', { businessId: 72, role: 'animator' });

    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'organization_management_denied');
    assert.deepEqual(writes(), []);
});

test('a real platform creator with the required action retains the organization bypass', async () => {
    state.user = { id: 41, role: 'director', platformRole: 'creator' };
    state.accountRole = 'creator';
    state.organizationMembership = null;
    const response = await request('PUT', '/8/members/52', { businessId: 72, role: 'animator' });

    assert.equal(response.status, 200);
    assert.equal(response.body.membership.role, 'animator');
    assert.equal(state.queries.some(item => item.sql.startsWith('SELECT role, is_active FROM users')), true);
    assert.equal(state.events[0].eventType, 'business_membership_updated');
});

test('explicit manage_accounts denial still blocks the platform organization bypass', async () => {
    state.user = { id: 41, role: 'creator', platformRole: 'creator', action_denylist: ['manage_accounts'] };
    state.organizationMembership = null;
    const response = await request('PUT', '/8/members/52', { businessId: 72, role: 'animator' });

    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'organization_management_denied');
    assert.deepEqual(writes(), []);
});

test('business creator cannot bootstrap an organization', async () => {
    state.user = { id: 41, role: 'creator', platformRole: 'manager' };
    const response = await request('POST', '/bootstrap', { name: 'Test Group', slug: 'test-group' });

    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'organization_bootstrap_denied');
    assert.equal(state.connects, 0);
    assert.deepEqual(state.queries, []);
});

test('real platform creator reaches the existing bootstrap guard without duplicating data', async () => {
    state.user = { id: 41, role: 'director', platformRole: 'creator' };
    state.accountRole = 'creator';
    const response = await request('POST', '/bootstrap', { name: 'Test Group', slug: 'test-group' });

    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'organization_bootstrap_complete');
    assert.equal(state.connects, 1);
    assert.equal(state.releases, 1);
    assert.deepEqual(writes(), []);
});

test('a temporary QA creator lease cannot bootstrap permanent organization ownership', async () => {
    state.user = {
        id: 41, role: 'creator', platformRole: 'creator',
        qaCreatorLeaseId: '11111111-1111-4111-8111-111111111111'
    };
    state.accountRole = 'manager';
    const response = await request('POST', '/bootstrap', { name: 'Test Group', slug: 'test-group' });

    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'organization_bootstrap_denied');
    assert.equal(state.queries.some(item => item.sql.startsWith('SELECT role, is_active FROM users')), true);
    assert.equal(state.queries.at(-1).sql, 'ROLLBACK');
    assert.equal(state.releases, 1);
    assert.deepEqual(writes(), []);
    assert.deepEqual(state.events, []);
});

test('explicit action denial blocks bootstrap even for the real platform creator', async () => {
    state.user = { id: 41, role: 'creator', platformRole: 'creator', action_denylist: ['manage_accounts'] };
    const response = await request('POST', '/bootstrap', { name: 'Test Group', slug: 'test-group' });

    assert.equal(response.status, 403);
    assert.equal(state.connects, 0);
    assert.deepEqual(state.queries, []);
});

test('lifecycle API rejects primary and extra creator assignment before any write', async () => {
    for (const body of [
        { businessId: 72, role: 'creator' },
        { businessId: 72, role: 'animator', extraRoles: ['creator'] },
        { businessId: 72, role: 'animator', extraRoles: [' creator '] }
    ]) {
        resetState();
        const response = await request('PUT', '/7/members/52', body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.body.code, 'business_membership_invalid');
        assert.equal(state.connects, 0);
        assert.deepEqual(writes(), []);
        assert.deepEqual(state.events, []);
    }
});

test('an active organization owner can assign ordinary business roles and retain explicit denies', async () => {
    const response = await request('PUT', '/7/members/52', {
        businessId: 72,
        role: 'animator',
        extraRoles: ['reception'],
        pageDenylist: ['/finance'],
        actionDenylist: ['create_booking']
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.membership.role, 'animator');
    const insert = state.queries.find(item => item.sql.startsWith('INSERT INTO business_memberships'));
    assert.deepEqual(insert.params.slice(0, 5), [72, 7, 52, 'animator', ['reception']]);
    assert.deepEqual(insert.params[6], ['/finance']);
    assert.deepEqual(insert.params[8], ['create_booking']);
    assert.equal(state.queries.some(item => item.sql.startsWith('UPDATE users SET session_revoked_at')), false);
    assert.equal(state.events[0].eventType, 'business_membership_updated');
    assert.equal(state.releases, 1);
});

test('organization owner can reactivate a business with no remaining operational memberships', async () => {
    state.user = {
        id: 41, role: null, roles: [], platformRole: 'manager',
        businessMembershipAccess: { configured: true, invalid: true, memberships: [], businessContexts: [] }
    };
    const response = await request('PATCH', '/businesses/72', { status: 'active' });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.business, { id: 72, context_key: 'dar', status: 'active' });
    const membershipRead = state.queries.find(item => item.sql.startsWith('SELECT om.role'));
    assert.deepEqual(membershipRead.params, [7, 41]);
    assert.equal(writes().length, 1);
    assert.deepEqual(writes()[0].params, ['active', 72, 7]);
    assert.equal(state.events[0].eventType, 'business_status_changed');
    assert.deepEqual(state.events[0].details, { businessId: 72, status: 'active' });
});

test('business recovery still denies an ordinary member, foreign user, or inactive owner before update', async () => {
    for (const organizationMembership of [
        { role: 'member', is_active: true },
        null,
        { role: 'owner', is_active: false }
    ]) {
        resetState();
        state.user = {
            id: 41, role: null, roles: [], platformRole: 'manager',
            businessMembershipAccess: { configured: true, invalid: true, memberships: [], businessContexts: [] }
        };
        state.organizationMembership = organizationMembership;
        const response = await request('PATCH', '/businesses/72', { status: 'active', organizationId: 8 });

        assert.equal(response.status, 403, JSON.stringify(organizationMembership));
        assert.equal(response.body.code, 'organization_management_denied');
        const membershipRead = state.queries.find(item => item.sql.startsWith('SELECT om.role'));
        assert.deepEqual(membershipRead.params, [7, 41], 'authorize the business organization from the database');
        assert.deepEqual(writes(), []);
        assert.deepEqual(state.events, []);
    }
});
