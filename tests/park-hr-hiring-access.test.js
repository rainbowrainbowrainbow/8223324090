'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applyMembershipAccess, buildMembershipAccess } = require('../services/businessMembership');
const { hiringRoute, requireParkHrHiringAccess } = require('../services/parkHrHiringAccess');
const { parkHrPayrollCapabilities } = require('../services/parkHrPayrollAccess');

function request(path, method = 'GET', context = 'event_genix', deny = []) {
    const principal = { id: 81, role: 'admin', business_contexts: ['event_genix', 'dar'] };
    const registry = ['event_genix', 'dar'].map((key, i) => ({ business_id: i + 1,
        organization_id: i + 1, context_key: key, access_mode: 'membership',
        business_status: 'active', organization_status: 'active' }));
    const memberships = registry.map(row => ({ ...row, role: 'admin', organization_role: 'member',
        business_modules: [], action_denylist: deny }));
    const user = applyMembershipAccess(principal, buildMembershipAccess(principal, memberships, context, registry));
    return { path, method, user, headers: { 'x-business-context': context }, query: {}, body: {} };
}

async function run(req, rows = [{ id: 41 }]) {
    const queries = [];
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    let next = false;
    await requireParkHrHiringAccess({ query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows };
    } })(req, res, () => { next = true; });
    return { queries, res, next };
}

test('Park admin owns vacancy, application and resume access through the parent vacancy', async () => {
    for (const [path, method] of [
        ['/vacancies', 'GET'], ['/vacancies', 'POST'], ['/vacancies/41', 'PATCH'],
        ['/vacancies/41', 'DELETE'], ['/vacancies/41/applications', 'POST'],
        ['/applications/41', 'PATCH'], ['/applications/41/hire', 'POST'],
        ['/applications/41/resume-files', 'POST'], ['/applications/41/resume-files/71/download', 'GET']
    ]) {
        const req = request(path, method);
        const result = await run(req);
        assert.equal(result.next, true, path);
        assert.equal(req.parkHrHiringAccess, true);
        for (const query of result.queries) {
            assert.match(query.sql, /business_context = \$2/);
            assert.deepEqual(query.params.slice(0, 2), ['41', 'event_genix']);
        }
        if (path.includes('/71/')) assert.equal(result.queries[0].params[2], '71');
    }
});

test('foreign, revoked, aggregated and explicitly denied requests stop before SQL', async () => {
    const cases = [
        request('/vacancies', 'GET', 'dar'),
        request('/vacancies', 'GET', 'event_genix', ['hr.staff.view']),
        request('/applications/41/hire', 'POST', 'event_genix', ['hr.staff.manage'])
    ];
    const revoked = request('/vacancies');
    revoked.user.businessMembershipAccess.invalid = true;
    cases.push(revoked);
    const all = request('/vacancies');
    all.query.businessScope = 'all';
    cases.push(all);
    for (const req of cases) {
        const result = await run(req);
        assert.equal(result.res.code, 403);
        assert.equal(result.queries.length, 0);
        assert.equal(result.next, false);
    }
});

test('unowned, foreign or mismatched parent records are unavailable to direct IDs', async () => {
    for (const path of ['/vacancies/41/applications', '/applications/41/resume-files/71/download']) {
        const result = await run(request(path), []);
        assert.equal(result.res.code, 404);
        assert.equal(result.next, false);
    }
    assert.equal(hiringRoute(request('/staff/41')), null);
    const overflow = await run(request('/applications/2147483648/resume-files'));
    assert.equal(overflow.res.code, 400);
    assert.equal(overflow.queries.length, 0);
});

test('profession-only edits use the staff lane while rate edits require payroll rules', () => {
    const req = request('/staff/41', 'PUT');
    req.body = { role_type: 'cook', secondary_professions: ['waiter'] };
    assert.equal(parkHrPayrollCapabilities(req, 'hr'), null);
    req.body.hourly_rate = 120;
    assert.ok(parkHrPayrollCapabilities(req, 'hr').includes('manage_payroll_rules'));
    req.method = 'GET';
    req.path = '/staff/41/role-assignments';
    assert.equal(parkHrPayrollCapabilities(req, 'hr'), null);
});
