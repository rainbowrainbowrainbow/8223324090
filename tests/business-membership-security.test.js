'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const jwt = require('jsonwebtoken');
const { resolveBusinessScope } = require('../services/businessContext');
const { resolveCapability } = require('../services/accountAccessPolicy');
const { businessScopeWriteGuard } = require('../middleware/businessScopeGuard');

const TEST_SECRET = 'membership-security-unit-secret';

function member(context = 'event_genix', overrides = {}) {
    return {
        organization_id: 7,
        organization_slug: 'qa_membership_org',
        organization_name: 'QA Membership Organization',
        organization_role: 'member',
        business_id: context === 'event_genix' ? 11 : 12,
        context_key: context,
        business_label: context,
        business_short_label: context,
        business_modules: [],
        access_mode: 'membership',
        role: 'animator',
        extra_roles: [],
        page_allowlist: [],
        page_denylist: [],
        action_allowlist: [],
        action_denylist: [],
        is_default: context === 'event_genix',
        ...overrides
    };
}

function registeredBusiness(context = 'event_genix', overrides = {}) {
    return {
        business_id: context === 'event_genix' ? 11 : 12,
        organization_id: 7,
        context_key: context,
        access_mode: 'membership',
        business_status: 'active',
        organization_status: 'active',
        ...overrides
    };
}

function fixture(t, overrides = {}) {
    const state = {
        user: {
            id: 42,
            username: 'qa_membership_unit',
            name: 'QA Membership Unit',
            role: 'director',
            extra_roles: [],
            page_allowlist: [],
            page_denylist: [],
            action_allowlist: [],
            action_denylist: [],
            business_contexts: ['event_genix', 'dar'],
            default_business_context: 'event_genix',
            is_active: true,
            session_revoked_at: null
        },
        memberships: [member()],
        registry: [registeredBusiness(), registeredBusiness('dar')],
        memberReads: 0,
        registryReads: 0,
        registryRequests: [],
        ...overrides
    };
    const pool = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            if (/^SELECT is_active, session_revoked_at FROM users/.test(text)) return { rows: [state.user] };
            if (/^SELECT id, username, role,/.test(text) && /FROM users WHERE id/.test(text)) return { rows: [state.user] };
            if (/FROM organization_memberships om/.test(text)) {
                state.memberReads += 1;
                return { rows: state.memberships };
            }
            if (/FROM businesses b/.test(text)) {
                state.registryReads += 1;
                state.registryRequests.push(params[0]);
                return { rows: state.registry.filter(row => params[0].includes(row.context_key)) };
            }
            if (/FROM employee_profiles/.test(text) || /^UPDATE (employee_profiles|users)/.test(text)) return { rows: [], rowCount: 0 };
            throw new Error(`Membership security fake pool does not support SQL: ${text}`);
        }
    };
    const dbId = require.resolve('../db');
    const authId = require.resolve('../middleware/auth');
    const oldDb = require.cache[dbId];
    const oldAuth = require.cache[authId];
    const oldSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = TEST_SECRET;
    require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool } };
    delete require.cache[authId];
    const auth = require('../middleware/auth');
    t.after(() => {
        clearInterval(auth.authenticateToken._activityCleanup);
        if (oldDb) require.cache[dbId] = oldDb;
        else delete require.cache[dbId];
        if (oldAuth) require.cache[authId] = oldAuth;
        else delete require.cache[authId];
        if (oldSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = oldSecret;
    });
    const token = jwt.sign({
        id: state.user.id,
        username: state.user.username,
        role: 'creator',
        roles: ['creator', 'director'],
        businessContexts: ['event_genix', 'dar'],
        sessionIssuedAt: Date.now()
    }, TEST_SECRET, { expiresIn: '15m' });

    async function request(options = {}, accessToken = token) {
        const req = {
            method: 'GET',
            path: '/api/business/profile',
            query: {},
            body: {},
            ...options,
            headers: { authorization: `Bearer ${accessToken}`, ...options.headers }
        };
        const result = { status: 200, next: false, body: null, req };
        const res = {
            status(code) { result.status = code; return this; },
            json(body) { result.body = body; return this; }
        };
        await auth.authenticateToken(req, res, () => { result.next = true; });
        return result;
    }
    return { state, request, token, auth };
}

test('fresh-token legacy grants cannot authorize a migrated business with zero memberships', async t => {
    const f = fixture(t, { memberships: [] });
    for (const context of ['event_genix', 'dar']) {
        const result = await f.request({ query: { businessContext: context } });
        assert.equal(result.status, 403, context);
        assert.equal(result.next, false);
        assert.equal(result.body.code, 'business_context_unavailable');
    }
    assert.equal(f.state.registryReads, 2);
});

test('an account with no business memberships retains its own account metadata without operational access', async t => {
    const f = fixture(t, { memberships: [] });
    f.state.user.extra_roles = ['creator'];
    f.state.user.page_allowlist = ['/finance'];
    f.state.user.action_allowlist = ['manage_accounts'];
    for (const options of [
        { method: 'GET', path: '/api/auth/security' },
        { method: 'GET', path: '/api/auth/verify' },
        { method: 'GET', path: '/api/auth/business-profile' },
        { method: 'GET', path: '/api/organizations' },
        { method: 'GET', path: '/api/organizations/members' },
        { method: 'GET', path: '/api/organizations/members/99/access-profile' },
        { method: 'POST', path: '/api/auth/logout' },
        { method: 'POST', path: '/api/auth/security/revoke-sessions' },
        { method: 'GET', path: '/security', originalUrl: '/api/auth/security/?limit=10' },
        { method: 'GET', path: '/auth/verify' }
    ]) {
        const result = await f.request(options);
        assert.equal(result.status, 200, JSON.stringify(options));
        assert.equal(result.next, true);
        assert.equal(result.req.user.id, f.state.user.id);
        assert.equal(result.req.user.role, null);
        const payload = f.auth.buildAuthUserPayload(result.req.user);
        assert.deepEqual(payload.roles, []);
        assert.deepEqual(payload.extraRoles, []);
        assert.deepEqual(payload.businessContexts, []);
        assert.deepEqual(payload.pageAllowlist, []);
        assert.deepEqual(payload.actionAllowlist, []);
        assert.equal(resolveCapability(payload, '/finance', { type: 'page' }).allowed, false);
    }
});

test('account endpoint exceptions do not admit operational profiles, permissions, unrelated paths, or different methods', async t => {
    const f = fixture(t, { memberships: [] });
    for (const options of [
        { method: 'GET', path: '/api/auth/profile' },
        { method: 'POST', path: '/api/auth/business-profile' },
        { method: 'GET', path: '/api/auth/business-profile/other' },
        { method: 'POST', path: '/api/organizations/members' },
        { method: 'GET', path: '/api/organizations/members/99/other' },
        { method: 'GET', path: '/api/auth/permissions' },
        { method: 'GET', path: '/api/business/profile' },
        { method: 'GET', path: '/api/auth/security/other' },
        { method: 'POST', path: '/api/auth/security' },
        { method: 'GET', path: '/api/auth/security/revoke-sessions' },
        { method: 'POST', path: '/api/organizations' },
        { method: 'GET', path: '/security', originalUrl: '/api/auth/profile' }
    ]) {
        const result = await f.request(options);
        assert.equal(result.status, 403, JSON.stringify(options));
        assert.equal(result.next, false);
        assert.equal(result.body.code, 'business_context_unavailable');
    }
});

test('accounts without an operational membership can reach exact organization lifecycle guards with cleared business permissions', async t => {
    const f = fixture(t, { memberships: [] });
    for (const options of [
        { method: 'POST', path: '/api/organizations/bootstrap' },
        { method: 'POST', path: '/api/organizations/7/businesses' },
        { method: 'PATCH', path: '/api/organizations/businesses/11' },
        { method: 'PUT', path: '/api/organizations/7/members/99' },
        { method: 'DELETE', path: '/api/organizations/7/members/99/11' },
        { method: 'PUT', path: '/7/members/99', originalUrl: '/api/organizations/7/members/99/?businessContext=event_genix' }
    ]) {
        const result = await f.request(options);
        assert.equal(result.status, 200, JSON.stringify(options));
        assert.equal(result.next, true);
        assert.equal(result.req.user.id, f.state.user.id);
        assert.equal(result.req.user.platformRole, 'director');
        assert.equal(result.req.user.role, null);
        assert.deepEqual(result.req.user.roles, []);
        assert.deepEqual(result.req.user.businessContexts, []);
        assert.equal(resolveCapability(result.req.user, '/finance', { type: 'page' }).allowed, false);
        assert.equal(resolveBusinessScope(result.req).invalid, true);
    }
});

test('organization lifecycle exceptions do not authorize neighboring operational paths or wrong methods', async t => {
    const f = fixture(t, { memberships: [] });
    for (const options of [
        { method: 'GET', path: '/api/organizations/bootstrap' },
        { method: 'POST', path: '/api/organizations/bootstrap-extra' },
        { method: 'GET', path: '/api/organizations/7/businesses' },
        { method: 'POST', path: '/api/organizations/7/businesses/11' },
        { method: 'PATCH', path: '/api/organizations/businesses/11/records' },
        { method: 'POST', path: '/api/organizations/7/members/99' },
        { method: 'DELETE', path: '/api/organizations/7/members/99' },
        { method: 'PUT', path: '/api/organizations/7/members/99/records' },
        { method: 'GET', path: '/7/members/99', originalUrl: '/api/organizations/7/members/99' }
    ]) {
        const result = await f.request(options);
        assert.equal(result.status, 403, JSON.stringify(options));
        assert.equal(result.next, false);
        assert.equal(result.body.code, 'business_context_unavailable');
    }
});

test('own-account context exceptions still reject missing tokens and inactive accounts', async t => {
    const f = fixture(t, { memberships: [] });
    const missing = await f.request({ path: '/api/auth/verify' }, '');
    assert.equal(missing.status, 401);
    assert.equal(missing.next, false);
    assert.equal(missing.body.code, 'auth_token_missing');
    f.state.user.is_active = false;
    const inactive = await f.request({ path: '/api/auth/security' });
    assert.equal(inactive.status, 401);
    assert.equal(inactive.next, false);
    assert.equal(inactive.body.code, 'auth_user_deactivated');
});

test('revoking the last membership denies the next request using the same still-valid JWT', async t => {
    const f = fixture(t);
    const before = await f.request({ query: { businessContext: 'event_genix' } });
    assert.equal(before.status, 200);
    assert.equal(before.next, true);
    f.state.memberships = [];
    const after = await f.request({ query: { businessContext: 'event_genix' } });
    assert.equal(after.status, 403);
    assert.equal(after.next, false);
    assert.equal(after.body.code, 'business_context_unavailable');
    assert.equal(f.state.memberReads, 2);
    assert.equal(f.state.registryReads, 2);
});

test('inactive business or organization cannot restore legacy access after active rows disappear', async t => {
    const f = fixture(t, { memberships: [] });
    for (const registryChange of [{ business_status: 'inactive' }, { organization_status: 'inactive' }]) {
        f.state.registry = [registeredBusiness('event_genix', registryChange)];
        const result = await f.request({ query: { businessContext: 'event_genix' } });
        assert.equal(result.status, 403, JSON.stringify(registryChange));
        assert.equal(result.next, false);
    }
});

test('query, header, and body context use the same membership boundary', async t => {
    const f = fixture(t);
    for (const options of [
        { query: { businessContext: 'dar' } },
        { query: { business_context: 'dar' } },
        { headers: { 'x-business-context': 'dar' } },
        { body: { business_context: 'dar' } }
    ]) {
        const result = await f.request(options);
        assert.equal(result.status, 403, JSON.stringify(options));
        assert.equal(result.next, false);
    }
    const own = await f.request({ headers: { 'x-business-context': 'park' } });
    assert.equal(own.status, 200);
    assert.equal(own.req.user.activeBusinessMembership.businessContext, 'event_genix');
});

test('a requested registered custom business is resolved even when legacy account grants never mention it', async t => {
    const f = fixture(t);
    f.state.user.business_contexts = ['event_genix'];
    f.state.registry.push(registeredBusiness('qa_foreign_business', { organization_id: 8, business_id: 13 }));
    const result = await f.request({ query: { businessContext: 'qa_foreign_business' } });
    assert.equal(result.status, 403);
    assert.equal(result.next, false);
    assert.equal(f.state.registryRequests.some(contexts => contexts.includes('qa_foreign_business')), true);
});

test('malformed explicit context never normalizes into authorized Park access', async t => {
    const f = fixture(t);
    for (const options of [
        { query: { businessContext: '../../dar' } },
        { headers: { 'x-business-context': '??' } },
        { body: { business_context: ['event_genix', 'dar'] } }
    ]) {
        const result = await f.request(options);
        assert.equal(result.status, 403, JSON.stringify(options));
        assert.equal(result.next, false);
    }
});

test('Dar-only and custom-only accounts authenticate in their membership context without Park fallback', async t => {
    const f = fixture(t);
    for (const context of ['dar', 'qa_custom_business']) {
        f.state.memberships = [member(context, { is_default: true })];
        f.state.registry = [registeredBusiness(), registeredBusiness(context)];
        const result = await f.request();
        assert.equal(result.status, 200, context);
        assert.equal(result.next, true);
        assert.equal(result.req.user.role, 'animator');
        assert.deepEqual(result.req.user.businessContexts, [context]);
        assert.equal(result.req.user.activeBusinessMembership.businessContext, context);
        assert.equal(resolveBusinessScope(result.req).activeContext, context);
        const park = await f.request({ query: { businessContext: 'event_genix' } });
        assert.equal(park.status, 403);
    }
});

test('role and override changes apply on the next request without stale JWT or adjacent-business permissions', async t => {
    const f = fixture(t, {
        memberships: [member(), member('dar', { role: 'accountant', page_allowlist: ['/finance'] })]
    });
    const before = await f.request({ query: { businessContext: 'dar' } });
    assert.equal(before.status, 200);
    assert.equal(before.req.user.role, 'accountant');
    assert.equal(resolveCapability(before.req.user, '/finance', { type: 'page' }).allowed, true);

    f.state.memberships[1] = member('dar', { role: 'animator', page_denylist: ['/finance'] });
    const after = await f.request({ headers: { 'x-business-context': 'dar' } });
    assert.equal(after.status, 200);
    assert.deepEqual(after.req.user.roles, ['animator']);
    assert.deepEqual(after.req.user.extraRoles, []);
    assert.deepEqual(after.req.user.pageAllowlist, []);
    assert.deepEqual(after.req.user.pageDenylist, ['/finance']);
    assert.equal(resolveCapability(after.req.user, '/finance', { type: 'page' }).allowed, false);
    const park = await f.request({ query: { businessContext: 'event_genix' } });
    assert.deepEqual(park.req.user.pageDenylist, []);
});

test('omitted context resolves the database membership default for both request role and scope', async t => {
    const f = fixture(t, {
        memberships: [member('event_genix', { is_default: false }), member('dar', { is_default: true, role: 'accountant' })]
    });
    const result = await f.request();
    assert.equal(result.status, 200);
    assert.equal(result.req.user.role, 'accountant');
    assert.equal(result.req.user.defaultBusinessContext, 'dar');
    assert.equal(resolveBusinessScope(result.req).activeContext, 'dar');
});

test('aggregate authorization rejects foreign organization selection and still allows a same-organization subset', async t => {
    const f = fixture(t, {
        memberships: [member(), member('dar'), member('qa_other_business', { organization_id: 8, business_id: 13 })],
        registry: [registeredBusiness(), registeredBusiness('dar'), registeredBusiness('qa_other_business', { organization_id: 8, business_id: 13 })]
    });
    for (const query of [
        { businessContext: 'event_genix', businessScope: 'all' },
        { businessContext: 'event_genix', businessScope: 'multi', businessContexts: 'event_genix,qa_other_business' }
    ]) {
        const result = await f.request({ query });
        assert.equal(result.status, 403, JSON.stringify(query));
        assert.equal(result.body.code, 'business_scope_organization_mismatch');
    }
    const sameOrg = await f.request({ headers: {
        'x-business-context': 'event_genix',
        'x-business-scope': 'multi',
        'x-business-contexts': 'event_genix,dar'
    } });
    assert.equal(sameOrg.status, 200);
    assert.equal(resolveBusinessScope(sameOrg.req).canWrite, false);
    const result = { status: 200, next: false, body: null };
    businessScopeWriteGuard({ ...sameOrg.req, method: 'POST', path: '/api/tasks' }, {
        status(code) { result.status = code; return this; },
        json(body) { result.body = body; }
    }, () => { result.next = true; });
    assert.equal(result.status, 403);
    assert.equal(result.next, false);
    assert.equal(result.body.code, 'business_scope_read_only');
});

test('all-business context aliases preserve same-organization aggregate reads without a writable fallback', async t => {
    const f = fixture(t, { memberships: [member(), member('dar')] });
    for (const options of [
        { query: { businessContext: 'all' } },
        { headers: { 'x-business-context': 'overview' } },
        { query: { businessScope: 'all' } }
    ]) {
        const result = await f.request(options);
        assert.equal(result.status, 200, JSON.stringify(options));
        const scope = resolveBusinessScope(result.req);
        assert.equal(scope.invalid, false);
        assert.equal(scope.mode, 'all');
        assert.equal(scope.canWrite, false);
        assert.deepEqual(scope.selectedContexts, ['event_genix', 'dar']);
    }
});

test('same-organization aggregate reads deny a permission mismatch while each individual membership remains usable', async t => {
    const f = fixture(t, { memberships: [member('event_genix', { role: 'accountant' }), member('dar')] });
    const aggregate = await f.request({ query: { businessContext: 'event_genix', businessScope: 'all' } });
    assert.equal(aggregate.status, 403);
    assert.equal(aggregate.next, false);
    assert.equal(aggregate.body.code, 'business_scope_permissions_mismatch');
    const park = await f.request({ query: { businessContext: 'event_genix' } });
    const dar = await f.request({ query: { businessContext: 'dar' } });
    assert.equal(park.status, 200);
    assert.equal(dar.status, 200);
    assert.equal(park.req.user.role, 'accountant');
    assert.equal(dar.req.user.role, 'animator');
});

test('an explicit compatibility context cannot lend its legacy role to same-organization membership data in aggregates', async t => {
    const f = fixture(t);
    f.state.user.business_contexts = ['event_genix', 'dar', 'maysternya_doli', 'crm'];
    f.state.registry.push(
        registeredBusiness('maysternya_doli', { business_id: 13, access_mode: 'compatibility' }),
        registeredBusiness('crm', { business_id: 14, access_mode: 'compatibility' })
    );
    const park = await f.request({ query: { businessContext: 'event_genix' } });
    assert.equal(park.status, 200);
    assert.equal(park.req.user.role, 'animator');
    assert.equal(resolveCapability(park.req.user, '/finance', { type: 'page' }).allowed, false);

    for (const context of ['maysternya_doli', 'crm']) {
        const single = await f.request({ query: { businessContext: context } });
        assert.equal(single.status, 200);
        assert.equal(single.req.user.role, 'director');
        assert.equal(single.req.user.businessMembershipAccess.membershipEnabled, false);
        for (const query of [
            { businessContext: context, businessScope: 'all' },
            { businessContext: context, businessScope: 'multi', businessContexts: `${context},event_genix` }
        ]) {
            const mixed = await f.request({ query });
            assert.equal(mixed.status, 403, JSON.stringify(query));
            assert.equal(mixed.next, false);
            assert.equal(mixed.body.code, 'business_scope_permissions_mismatch');
        }
    }
});

test('configured compatibility-only aggregate reads preserve legacy access within their organization', async t => {
    const f = fixture(t, {
        memberships: [],
        registry: [
            registeredBusiness('maysternya_doli', { business_id: 13, access_mode: 'compatibility' }),
            registeredBusiness('crm', { business_id: 14, access_mode: 'compatibility' })
        ]
    });
    f.state.user.business_contexts = ['maysternya_doli', 'crm'];
    f.state.user.default_business_context = 'maysternya_doli';
    for (const query of [
        { businessContext: 'maysternya_doli', businessScope: 'all' },
        { businessContext: 'crm', businessScope: 'multi', businessContexts: 'maysternya_doli,crm' }
    ]) {
        const result = await f.request({ query });
        assert.equal(result.status, 200, JSON.stringify(query));
        assert.equal(result.next, true);
        assert.equal(result.req.user.role, 'director');
        assert.equal(result.req.user.businessMembershipAccess.configured, true);
        assert.equal(result.req.user.businessMembershipAccess.membershipEnabled, false);
        const scope = resolveBusinessScope(result.req);
        assert.equal(scope.invalid, false);
        assert.equal(scope.readOnly, true);
        assert.equal(scope.canWrite, false);
        assert.deepEqual(scope.selectedContexts, ['maysternya_doli', 'crm']);
    }
});

test('multiple organization defaults require an explicit business instead of selecting one arbitrarily', async t => {
    const f = fixture(t, {
        memberships: [member(), member('qa_other_business', { organization_id: 8, business_id: 13, is_default: true })],
        registry: [registeredBusiness(), registeredBusiness('qa_other_business', { organization_id: 8, business_id: 13 })]
    });
    const missing = await f.request();
    assert.equal(missing.status, 403);
    assert.equal(missing.body.code, 'business_context_required');
    const explicit = await f.request({ query: { businessContext: 'qa_other_business' } });
    assert.equal(explicit.status, 200);
    assert.equal(explicit.req.user.activeBusinessMembership.organizationId, 8);
});

test('production database errors cannot opt into the Node test-double compatibility fallback', () => {
    const env = { ...process.env, NODE_ENV: 'production' };
    delete env.NODE_TEST_CONTEXT;
    const script = `
        const assert = require('node:assert/strict');
        const { loadMembershipAccess } = require('./services/businessMembership');
        (async () => {
            for (const error of [
                new Error('Unexpected test-double query: membership'),
                new Error('Unexpected SQL in auth lifecycle test: membership'),
                Object.assign(new Error('relation business_memberships does not exist'), { code: '42P01' }),
                Object.assign(new Error('database unavailable'), { code: '08006' })
            ]) {
                await assert.rejects(loadMembershipAccess({ query: async () => { throw error; } }, { id: 42 }, 'event_genix'), value => value === error);
            }
            process.stdout.write('production-errors-denied');
        })().catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
        cwd: require('node:path').join(__dirname, '..'), env, encoding: 'utf8', timeout: 10000
    });
    assert.equal(output, 'production-errors-denied');
});
