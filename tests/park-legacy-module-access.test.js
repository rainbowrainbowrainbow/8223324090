'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');
const { legacyBusinessSurfaceAccess } = require('../services/legacyBusinessSurface');
const { parkLegacySurfaceAvailability } = require('../services/parkLegacyModuleAccess');
const { buildBusinessOperatingProfile } = require('../services/businessProfile');

function request(context = 'event_genix', role = 'senior_manager', pageDenylist = []) {
    const account = { id: 101, role, default_business_context: context };
    const rows = ['event_genix', 'dar'].map((key, index) => ({
        business_id: index + 1, organization_id: 1, context_key: key,
        access_mode: 'membership', business_status: 'active', organization_status: 'active',
        role, business_modules: [], page_denylist: pageDenylist, is_default: key === context
    }));
    const user = applyMembershipAccess(account, buildMembershipAccess(account, rows, context, rows));
    return { user, headers: { 'x-business-context': context }, query: {}, body: {}, method: 'GET', path: '/' };
}

test('Park memberships can use both recovered surfaces with their canonical page permissions', () => {
    for (const role of ['senior_manager', 'art_director', 'director', 'creator']) {
        const req = request('event_genix', role);
        for (const surface of ['certificates', 'art']) {
            assert.equal(legacyBusinessSurfaceAccess(req, surface).available, true, `${role}:${surface}`);
        }
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            assert.equal(legacyBusinessSurfaceAccess({ ...req, method }, 'certificates').available, true);
        }
    }
});

test('new and batch certificate pages and Art aliases retain explicit denials', () => {
    const createDenied = request('event_genix', 'senior_manager', ['/certificates/new']);
    assert.equal(legacyBusinessSurfaceAccess(createDenied, 'certificates').available, true);
    assert.equal(legacyBusinessSurfaceAccess({ ...createDenied, method: 'POST' }, 'certificates').available, false);
    assert.equal(legacyBusinessSurfaceAccess({ ...createDenied, method: 'POST', path: '/batch' }, 'certificates').available, true);
    const batchDenied = request('event_genix', 'art_director', ['/certificates/batch']);
    assert.equal(legacyBusinessSurfaceAccess({ ...batchDenied, method: 'POST', path: '/BATCH/' }, 'certificates').available, false);
    const listDenied = request('event_genix', 'director', ['/certificates']);
    assert.equal(legacyBusinessSurfaceAccess(listDenied, 'certificates').available, false);
    const artDenied = request('event_genix', 'art_director', ['/art-director']);
    assert.equal(legacyBusinessSurfaceAccess(artDenied, 'art').available, false);
    assert.equal(parkLegacySurfaceAvailability(artDenied.user, 'event_genix').art.available, false);
});

test('foreign and aggregate business scopes remain unavailable, even to Creator', () => {
    for (const context of ['dar', 'crm', 'maysternya_doli', 'fixture_foreign']) {
        for (const surface of ['certificates', 'art']) {
            assert.equal(legacyBusinessSurfaceAccess(request(context, 'creator'), surface).available, false);
        }
    }
    for (const mode of ['all', 'multi']) {
        const req = request('event_genix', 'creator');
        req.query = { businessScope: mode, businessContexts: 'event_genix,dar' };
        for (const surface of ['certificates', 'art']) assert.equal(legacyBusinessSurfaceAccess(req, surface).available, false);
    }
});

test('missing, revoked, inactive, duplicate and mismatched membership identities fail closed', () => {
    const corruptions = [
        user => { user.businessMembershipAccess.invalid = true; },
        user => { user.businessMembershipAccess.memberships = []; },
        user => { user.businessMembershipAccess.registry[0].active = false; },
        user => { user.businessMembershipAccess.registry.push({ ...user.businessMembershipAccess.registry[0] }); },
        user => { user.businessMembershipAccess.memberships.push({ ...user.businessMembershipAccess.memberships[0] }); },
        user => { user.activeBusinessMembership = null; },
        user => { user.businessMembershipAccess.activeMembership = null; },
        user => { user.activeBusinessMembership = { ...user.activeBusinessMembership, organizationId: 99 }; },
        user => { user.activeBusinessMembership = { ...user.activeBusinessMembership, businessId: 99 }; },
        user => { user.businessMembershipAccess.registry[0].organizationId = 0; },
        user => { user.businessMembershipAccess.registry[0].businessId = NaN; },
        user => { user.businessMembershipAccess.registry[0].accessMode = 'compatibility'; }
    ];
    for (const corrupt of corruptions) {
        const req = request();
        corrupt(req.user);
        for (const surface of ['certificates', 'art']) {
            assert.equal(legacyBusinessSurfaceAccess(req, surface).available, false, corrupt.toString());
            assert.equal(parkLegacySurfaceAvailability(req.user, 'event_genix')[surface].available, false);
        }
    }
});

test('recovery does not activate unrelated namespaces or module configuration', async () => {
    const req = request();
    for (const surface of ['staff', 'payroll', 'chat', 'catalogs', 'recurring']) {
        assert.equal(legacyBusinessSurfaceAccess(req, surface).available, false, surface);
    }
    const db = { async query(sql) { assert.match(sql, /^SELECT /); return { rows: [] }; } };
    const profile = await buildBusinessOperatingProfile(db, req.user, { includeIntegrations: false });
    assert.equal(profile.activeProfile.legacySurfaces.certificates.available, true);
    assert.equal(profile.activeProfile.legacySurfaces.art.available, true);
    assert.equal(profile.activeProfile.modules.enabled.certificates, false);
    assert.equal(profile.activeProfile.modules.enabled.art, false);
    assert.equal(profile.businesses.find(item => item.key === 'dar').legacySurfaces.certificates.available, false);
    const dar = await buildBusinessOperatingProfile(db, request('dar').user, { includeIntegrations: false });
    assert.equal(dar.businesses.find(item => item.key === 'event_genix').legacySurfaces.certificates.available, false);
});
