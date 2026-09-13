'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

function fixture(t, globalRole) {
    const state = {
        user: {
            id: 42, username: 'membership_profile_fixture', name: 'Membership profile fixture',
            display_name: 'Fixture display name', bio: 'Fixture biography',
            role: globalRole, extra_roles: ['accountant'],
            page_allowlist: ['/finance'], page_denylist: [],
            action_allowlist: ['view_revenue'], action_denylist: [],
            business_contexts: ['event_genix', 'dar'], default_business_context: 'event_genix',
            is_active: true, session_revoked_at: null,
            avatar_emoji: null, avatar_color: null, avatar_url: null
        },
        memberships: [{
            organization_id: 7, organization_slug: 'fixture-org', organization_name: 'Fixture organization',
            organization_role: 'member', business_id: 12, context_key: 'dar',
            business_label: 'Fixture Dar', business_short_label: 'Dar', business_modules: [],
            access_mode: 'membership', role: 'animator', extra_roles: ['instructor'],
            page_allowlist: ['/programs'], page_denylist: ['/finance'],
            action_allowlist: ['create_booking'], action_denylist: ['view_revenue'], is_default: true
        }],
        taskListQueries: [],
        queriedProfileRows: 0
    };
    const pool = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            if (/^SELECT is_active, session_revoked_at FROM users/.test(text)) return { rows: [state.user] };
            if (/^SELECT id, username, role,/.test(text) && /FROM users WHERE id/.test(text)) return { rows: [state.user] };
            if (/FROM organization_memberships om/.test(text)) return { rows: state.memberships };
            if (/FROM businesses b/.test(text)) {
                return { rows: ['event_genix', 'dar'].filter(context => params[0].includes(context)).map(context => ({
                    business_id: context === 'dar' ? 12 : 11, organization_id: 7,
                    context_key: context, access_mode: 'membership', business_status: 'active', organization_status: 'active'
                })) };
            }
            if (/FROM users u LEFT JOIN user_profiles_ext/.test(text) && /WHERE u.username = \$1/.test(text)) {
                state.queriedProfileRows += 1;
                // Deliberately return the account role again after membership authentication.
                return { rows: [{ ...state.user }] };
            }
            if (/^SELECT id, title, status, priority, deadline,/.test(text) && /FROM tasks/.test(text)) {
                state.taskListQueries.push({ sql: text, params: [...params] });
                const predicate = /COALESCE\(tasks\.business_context,\s*'event_genix'\)\s*=\s*\$(\d+)/.exec(text);
                const context = predicate ? params[Number(predicate[1]) - 1] : null;
                return { rows: [
                    { id: 101, title: 'Park-only task', business_context: 'event_genix' },
                    { id: 102, title: 'Dar-only task', business_context: 'dar' }
                ].filter(row => !context || row.business_context === context).map(row => ({
                    ...row, status: 'todo', priority: 'normal', dependency_ids: []
                })) };
            }
            if (/FROM employee_profiles/.test(text) || /^UPDATE (employee_profiles|users)/.test(text)) return { rows: [], rowCount: 0 };
            // The personal profile deliberately tolerates unavailable unrelated panels.
            // Keep this focused fake from claiming coverage of HR, finance or achievements.
            throw new Error('Unrelated profile panel is outside this route fixture');
        }
    };
    const moduleIds = ['../db', '../middleware/auth', '../routes/auth'].map(name => require.resolve(name));
    const originals = new Map(moduleIds.map(id => [id, require.cache[id]]));
    const dbId = moduleIds[0];
    require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool } };
    delete require.cache[moduleIds[1]];
    delete require.cache[moduleIds[2]];
    const auth = require('../middleware/auth');
    const router = require('../routes/auth');
    t.after(() => {
        clearInterval(auth.authenticateToken._activityCleanup);
        for (const [id, original] of originals) {
            if (original) require.cache[id] = original;
            else delete require.cache[id];
        }
    });
    const token = jwt.sign({ ...auth.buildAuthUserPayload(state.user), sessionIssuedAt: Date.now() }, auth.JWT_SECRET, { expiresIn: '5m' });

    async function request(path) {
        const req = {
            method: 'GET', path, originalUrl: '/api/auth' + path,
            headers: { authorization: 'Bearer ' + token }, query: {}, body: {}, params: {}
        };
        const result = { status: 200, body: null, req };
        const res = {
            status(value) { result.status = value; return this; },
            json(value) { result.body = value; return this; }
        };
        const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods.get)?.route;
        assert.ok(route, 'The real auth router must expose ' + path);
        for (const layer of route.stack) {
            let nextCalled = false;
            await layer.handle(req, res, error => {
                if (error) throw error;
                nextCalled = true;
            });
            if (!nextCalled) break;
        }
        assert.notEqual(result.body, null, 'The real handler must finish the response');
        return result;
    }
    return { state, request };
}

for (const globalRole of ['creator', 'director', 'manager']) {
    test(`real verify/profile preserve Dar membership over raw account ${globalRole} without explicit context`, async t => {
        const f = fixture(t, globalRole);
        const verify = await f.request('/verify');
        assert.equal(verify.status, 200);
        assert.equal(verify.body.user.role, 'animator');
        assert.deepEqual(verify.body.user.roles, ['animator', 'instructor']);
        assert.deepEqual(verify.body.user.extraRoles, ['instructor']);
        assert.deepEqual(verify.body.user.pageAllowlist, ['/programs']);
        assert.deepEqual(verify.body.user.pageDenylist, ['/finance']);
        assert.deepEqual(verify.body.user.actionAllowlist, ['create_booking']);
        assert.deepEqual(verify.body.user.actionDenylist, ['view_revenue']);
        assert.deepEqual(verify.body.user.businessContexts, ['dar']);
        assert.equal(verify.body.user.defaultBusinessContext, 'dar');

        const profile = await f.request('/profile');
        assert.equal(profile.status, 200);
        assert.equal(profile.body.user.role, 'animator');
        assert.equal(profile.body.user.displayName, 'Fixture display name');
        assert.equal(profile.body.user.bio, 'Fixture biography');
        assert.equal(Object.hasOwn(profile.body.bookings, 'revenue'), false);
        assert.deepEqual(profile.body.team, []);
        assert.deepEqual(profile.body.myTasks.map(task => task.id), [102]);
        assert.deepEqual(profile.body.myTasks.map(task => task.title), ['Dar-only task']);
        assert.equal(f.state.taskListQueries.length, 1);
        assert.equal(f.state.taskListQueries[0].params.at(-1), 'dar');
        assert.equal(f.state.queriedProfileRows, 2, 'Both routes must actually read the raw account row');
    });
}

test('actual verify refreshes membership overrides on the next request using the same JWT', async t => {
    const f = fixture(t, 'director');
    assert.deepEqual((await f.request('/verify')).body.user.extraRoles, ['instructor']);
    Object.assign(f.state.memberships[0], {
        role: 'instructor', extra_roles: [], page_allowlist: [],
        page_denylist: ['/finance', '/programs'], action_allowlist: [],
        action_denylist: ['view_revenue', 'create_booking']
    });
    const result = await f.request('/verify');
    assert.equal(result.status, 200);
    assert.equal(result.body.user.role, 'instructor');
    assert.deepEqual(result.body.user.roles, ['instructor']);
    assert.deepEqual(result.body.user.extraRoles, []);
    assert.deepEqual(result.body.user.pageAllowlist, []);
    assert.deepEqual(result.body.user.pageDenylist, ['/finance', '/programs']);
    assert.deepEqual(result.body.user.actionAllowlist, []);
    assert.deepEqual(result.body.user.actionDenylist, ['view_revenue', 'create_booking']);
});

test('actual verify keeps account identity without restoring global grants after the last membership is revoked', async t => {
    const f = fixture(t, 'creator');
    assert.equal((await f.request('/verify')).body.user.role, 'animator');
    f.state.memberships = [];
    const verify = await f.request('/verify');
    assert.equal(verify.status, 200);
    assert.equal(verify.body.user.id, f.state.user.id);
    assert.equal(verify.body.user.role, null);
    for (const key of ['roles', 'extraRoles', 'businessContexts', 'pageAllowlist', 'actionAllowlist']) {
        assert.deepEqual(verify.body.user[key], [], key);
    }
    const profile = await f.request('/profile');
    assert.equal(profile.status, 403);
    assert.equal(profile.body.code, 'business_context_unavailable');
    assert.equal(f.state.taskListQueries.length, 0, 'A revoked user must not reach operational task reads');
});
