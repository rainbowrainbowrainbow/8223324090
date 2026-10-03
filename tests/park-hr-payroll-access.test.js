'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');
const { requireParkHrPayrollAccess, parkHrPayrollCapabilities } = require('../services/parkHrPayrollAccess');
const { requireLegacyBusinessSurface } = require('../services/legacyBusinessSurface');

const contexts = ['event_genix', 'dar', 'foreign_business'];
const actor = { id: 91, role: 'creator', business_contexts: contexts, default_business_context: 'event_genix' };
const registry = context => ({ business_id: contexts.indexOf(context) + 1,
    organization_id: context === 'foreign_business' ? 2 : 1, context_key: context,
    access_mode: 'membership', business_status: 'active', organization_status: 'active' });
function request(path = '/payroll-profiles', method = 'GET', options = {}) {
    const context = options.context || 'event_genix';
    const memberships = contexts.filter(key => key !== options.revoked).map(key => ({ ...registry(key),
        role: 'creator', organization_role: 'owner', is_default: key === 'event_genix',
        action_denylist: options.deny || [] }));
    const user = applyMembershipAccess(actor, buildMembershipAccess(actor, memberships, context, contexts.map(registry)));
    return { user, method, path, headers: { 'x-business-context': context }, query: {}, body: options.body || {} };
}
async function invoke(req, options = {}) {
    let calls = 0, passed = false, status = 200, body;
    const db = { query: async (sql, values) => {
        calls++;
        assert.match(sql, /business_context IS DISTINCT FROM \$1/); assert.deepEqual(values, ['event_genix']);
        if (options.error) throw Error('private connection details');
        return { rows: [{ ownership_conflict: options.conflict === true }] };
    } };
    const routerId = options.routerId || 'hr';
    const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
    await requireParkHrPayrollAccess(routerId, requireLegacyBusinessSurface(routerId === 'hr' ? 'staff' : 'payroll'), db)(req, res, () => {
        passed = true;
        if (options.response) res.json(options.response);
    });
    return { passed, status, body, calls };
}

test('fresh Park membership opens only the enumerated conditions, profiles and attendance methods', async () => {
    for (const [method, path, body] of [
        ['GET','/payroll-profiles'], ['GET','/staff/12/payroll-conditions'], ['GET','/salary'],
        ['GET','/today'], ['GET','/professions/workspace/animator'],
        ['POST','/payroll-profiles'], ['POST','/payroll-profiles/4/versions'],
        ['PUT','/staff/12/payroll-day-exception'], ['PUT','/staff/12/payroll-profile-assignments'],
        ['PUT','/staff/12', { profession_rates: [] }], ['POST','/clock-in'], ['PUT','/records/7/correct']
    ]) {
        const result = await invoke(request(path, method, { body }));
        assert.equal(result.passed, true, `${method} ${path}: ${JSON.stringify(result)}`);
        assert.equal(result.calls, 1);
    }
    assert.equal((await invoke(request('/preview'), { routerId: 'payroll' })).passed, true);
});

test('payments, close, settlements, bulk and unrelated HR writes remain denied even for creator', async () => {
    for (const [routerId, method, path, body] of [
        ['payroll','POST','/installments/1/payments/confirm'], ['payroll','POST','/payments/1/reverse'],
        ['payroll','POST','/period/close'], ['payroll','POST','/installments/calculate'],
        ['payroll','GET','/settlement'], ['payroll','GET','/payment-options'],
        ['hr','POST','/salary/commit'], ['hr','POST','/payroll-profiles/bulk/apply'],
        ['hr','PUT','/staff/12',{ hourly_rate: 120, hr_pool_status: 'terminated' }],
        ['hr','PUT','/staff/12',{ name: 'Unrelated edit' }], ['hr','DELETE','/staff/12'],
        ['hr','PATCH','/staff/12/payroll-day-exception'], ['hr','GET','/payroll-profiles/1/versions/unknown']
    ]) {
        const req = request(path, method, { body });
        assert.equal(parkHrPayrollCapabilities(req, routerId), null, path);
        const result = await invoke(req, { routerId });
        assert.equal(result.passed, false, path); assert.equal(result.status, 403, path);
        assert.equal(result.calls, 0, path);
    }
});

test('another business, aggregate, revoked and inconsistent membership cannot use the Park lane', async () => {
    const stale = request(); stale.user.activeBusinessMembership.organizationId = 99;
    for (const req of [request(undefined, undefined, { context: 'dar' }),
        request(undefined, undefined, { context: 'foreign_business' }),
        request(undefined, undefined, { context: 'all' }),
        request(undefined, undefined, { revoked: 'event_genix' }), stale]) {
        const result = await invoke(req);
        assert.equal(result.passed, false); assert.equal(result.status, 403); assert.equal(result.calls, 0);
    }
});

test('existing salary and export denies apply before data queries', async () => {
    for (const [routerId, method, path, deny] of [
        ['hr','GET','/payroll-profiles','hr.payroll.view'],
        ['hr','PUT','/staff/1/payroll-day-exception','hr.payroll.manage'],
        ['hr','PUT','/staff/1/payroll-day-exception','manage_payroll_rules'],
        ['hr','POST','/clock-in','hr.schedule.manage'],
        ['payroll','GET','/export','export_data'], ['payroll','GET','/preview','view_payroll']
    ]) {
        const result = await invoke(request(path, method, { deny: [deny] }), { routerId });
        assert.equal(result.passed, false, deny); assert.equal(result.status, 403); assert.equal(result.calls, 0);
        assert.doesNotMatch(JSON.stringify(result.body), /hourly_rate|defaultRate|password/);
    }
});

test('foreign or unknown record ownership and unavailable database fail closed without details', async () => {
    assert.equal((await invoke(request(), { conflict: true })).status, 409);
    const failed = await invoke(request(), { error: true });
    assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed.body), /private|connection/);
});

test('Today keeps its projection and enables mutations only with the existing schedule capability', async () => {
    const response = { success: true, data: [{ id: 3, hourly_rate: 999, password_hash: 'private' }], summary: {} };
    const editor = await invoke(request('/today'), { response });
    assert.equal(editor.body.todayAccess.readOnly, false);
    assert.doesNotMatch(JSON.stringify(editor.body), /999|private|password_hash/);
    const reader = await invoke(request('/today','GET',{ deny: ['hr.schedule.manage'] }), { response });
    assert.equal(reader.body.todayAccess.readOnly, true);
});

test('salary preview advertises read-only settlement controls', async () => {
    const result = await invoke(request('/salary'), { response: { success: true,
        payroll_activation: { active: true, readOnly: false, calculateEndpoint: '/write' } } });
    assert.equal(result.body.payroll_activation.readOnly, true);
    assert.equal(result.body.payroll_activation.calculateEndpoint, null);
});
