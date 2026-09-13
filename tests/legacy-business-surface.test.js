'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');
const { legacyBusinessSurfaceAccess, requireLegacyBusinessSurface, loadLegacyBusinessSurfaceAccess } = require('../services/legacyBusinessSurface');

const contexts = ['event_genix', 'dar', 'crm', 'maysternya_doli'];
const actor = { id: 1, username: 'synthetic_actor', role: 'director', business_contexts: contexts, default_business_context: 'event_genix' };
const registry = (context, mode = 'membership', extra = {}) => ({ business_id: context === 'event_genix' ? 1 : 2,
    organization_id: 1, context_key: context, access_mode: mode, business_status: 'active', organization_status: 'active', ...extra });
const member = context => ({ ...registry(context), role: 'director', organization_role: 'owner', is_default: context === 'event_genix' });
function request(context, rows = [], registryRows = [], principal = actor) {
    const user = applyMembershipAccess(principal, buildMembershipAccess(principal, rows, context, registryRows));
    return { user, headers: { 'x-business-context': context }, query: {}, body: {} };
}

test('only current single pre-cutover Park keeps existing legacy availability', () => {
    assert.equal(legacyBusinessSurfaceAccess(request('event_genix')).available, true);
    assert.equal(legacyBusinessSurfaceAccess(request('event_genix', [], [registry('event_genix', 'compatibility')])).available, true);
    for (const context of ['dar', 'crm', 'maysternya_doli']) {
        assert.equal(legacyBusinessSurfaceAccess(request(context)).available, false, context);
    }
});

test('owners and platform creators cannot use migrated global surfaces or recover them by switching to CRM', () => {
    for (const role of ['director', 'creator']) {
        const principal = { ...actor, role };
        const members = ['event_genix', 'dar'].map(member);
        const registryRows = ['event_genix', 'dar'].map(context => registry(context));
        for (const context of contexts) {
            const req = request(context, members, registryRows, principal);
            const decision = legacyBusinessSurfaceAccess(req);
            assert.equal(decision.available, false, role + ':' + context);
            assert.equal(decision.code, 'catalogs_not_migrated');
            if (context === 'crm') assert.equal(req.user.businessMembershipAccess.membershipEnabled, false, 'Actual compatibility bypass fixture');
        }
    }
});

test('invalid/revoked/inactive scopes and missing authenticated registry snapshot never become legacy access', () => {
    const revoked = request('event_genix', [], [registry('event_genix')]);
    assert.equal(legacyBusinessSurfaceAccess(revoked).code, 'business_context_unavailable');
    const inactive = request('event_genix', [], [registry('event_genix', 'compatibility', { business_status: 'inactive' })]);
    assert.equal(legacyBusinessSurfaceAccess(inactive).available, false);
    assert.equal(legacyBusinessSurfaceAccess({ user: actor }).available, false);
    assert.equal(legacyBusinessSurfaceAccess({}).status, 401);
    const inconsistent = request('event_genix');
    inconsistent.user.businessMembershipAccess.registry = [{ businessContext: 'event_genix', accessMode: 'membership', active: true }];
    assert.equal(legacyBusinessSurfaceAccess(inconsistent).available, false);
});

test('aggregate and header/query/body aliases cannot bypass containment', () => {
    for (const mode of ['all', 'multi']) {
        const req = request('event_genix', ['event_genix', 'dar'].map(member), ['event_genix', 'dar'].map(context => registry(context)));
        req.query = { businessScope: mode, businessContexts: 'event_genix,dar' };
        assert.equal(legacyBusinessSurfaceAccess(req).available, false);
    }
    for (const input of [{ headers: { 'x-business-context': 'crm' } }, { query: { business_context: 'crm' } }, { body: { businessContext: 'crm' } }]) {
        assert.equal(legacyBusinessSurfaceAccess({ ...request('event_genix'), ...input }).available, false);
    }
});

test('middleware emits stable surface errors before calling the domain handler', () => {
    for (const [surface, code] of Object.entries({ catalogs: 'catalogs_not_migrated', booking_templates: 'booking_templates_not_migrated',
        recurring: 'recurring_not_migrated', finance_salary: 'finance_salary_not_migrated', payroll: 'payroll_not_migrated',
        staff: 'staff_not_migrated', certificates: 'certificates_not_migrated', art: 'art_not_migrated',
        contractors_procurement: 'contractors_procurement_not_migrated' })) {
        const req = request('crm');
        let nextCalls = 0;
        const res = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
        requireLegacyBusinessSurface(surface)(req, res, () => nextCalls++);
        assert.equal(nextCalls, 0);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, code);
        assert.equal(res.body.success, false);
        requireLegacyBusinessSurface(surface)(request('event_genix'), res, () => nextCalls++);
        assert.equal(nextCalls, 1);
    }
});

test('trusted internal callers need an explicit Park context before even consulting the registry', async () => {
    const db = { async query() { throw new Error('Registry must not be queried'); } };
    for (const context of [undefined, null, '', 'dar', 'crm', 'maysternya_doli', 'unknown']) {
        const decision = await loadLegacyBusinessSurfaceAccess(db, context);
        assert.equal(decision.available, false);
        assert.equal(decision.code, 'catalogs_not_migrated');
    }
});

test('internal registry is fresh on every call and refuses inactive, missing-org or migrated targets', async () => {
    let rows = [];
    let calls = 0;
    const db = { async query(sql, params) { calls++; assert.deepEqual(params, ['event_genix']); return { rows }; } };
    assert.equal((await loadLegacyBusinessSurfaceAccess(db, 'event_genix')).available, true);
    rows = [{ access_mode: 'compatibility', business_status: 'active', organization_status: 'active' }];
    assert.equal((await loadLegacyBusinessSurfaceAccess(db, 'event_genix')).available, true);
    for (const change of [{ access_mode: 'membership' }, { business_status: 'inactive' }, { organization_status: null }, { access_mode: 'unknown' }]) {
        rows = [{ access_mode: 'compatibility', business_status: 'active', organization_status: 'active', ...change }];
        assert.equal((await loadLegacyBusinessSurfaceAccess(db, 'event_genix')).available, false);
    }
    assert.equal(calls, 6);
});

test('registry failure never grants internal legacy access or exposes driver details', async () => {
    const db = { async query() { throw new Error('SYNTHETIC_PRIVATE_CONNECTION_DETAIL'); } };
    const decision = await loadLegacyBusinessSurfaceAccess(db, 'event_genix');
    assert.equal(decision.available, false);
    assert.equal(decision.status, 503);
    assert.equal(JSON.stringify(decision).includes('SYNTHETIC_PRIVATE'), false);
});
