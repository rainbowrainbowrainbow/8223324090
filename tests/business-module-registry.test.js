'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../services/businessModuleRegistry');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');
const { businessCabinetForUser } = require('../services/businessCabinet');
const { businessModulesForContext } = require('../services/businessContext');
const { buildBusinessOperatingProfile, buildModuleMap } = require('../services/businessProfile');
const { canUseTimelineAction } = require('../services/timelineContext');

function actor(modules, context = 'fixture_studio', role = 'manager') {
    const account = { id: 9, role: 'director', default_business_context: context };
    const rows = [{ organization_id: 1, business_id: 2, context_key: context,
        business_label: 'Registry name', business_short_label: 'Registry short', business_modules: modules,
        access_mode: 'membership', role, is_default: true }];
    return applyMembershipAccess(account, buildMembershipAccess(account, rows, context));
}

test('explicit empty and missing membership modules fail closed without Park defaults', () => {
    for (const context of ['event_genix', 'dar', 'fixture_studio']) {
        for (const modules of [[], undefined, null]) {
            const user = actor(modules, context);
            assert.equal(registry.userBusinessModuleState(user, context, 'timeline').available, false);
            assert.deepEqual(businessModulesForContext(context, user), []);
            const map = buildModuleMap(context, {}, { modules: { enabled: { timeline: true, dashboard: true } } }, modules, true);
            assert.deepEqual(map.enabledIds, []);
        }
    }
    assert.deepEqual(businessModulesForContext('fixture_studio'), []);
    assert.ok(businessModulesForContext('event_genix').includes('timeline'));
});

test('unknown/unsupported module configuration cannot grant runtime access, preserved values remain disabled', () => {
    for (const key of ['hr', 'catalogs', 'unregistered_module', 'graduation']) {
        assert.throws(() => registry.validateBusinessModules([key], { contextKey: 'fixture_studio' }), { code: 'business_module_not_supported' });
        assert.deepEqual(registry.validateBusinessModules([key], { contextKey: 'fixture_studio', existingModules: [key] }), [key]);
        assert.equal(registry.userBusinessModuleState(actor([key]), 'fixture_studio', key).available, false);
    }
    for (const value of [undefined, null, false, {}, [' tasks '], [2]]) {
        assert.throws(() => registry.validateBusinessModules(value, { contextKey: 'fixture_studio' }));
    }
    assert.deepEqual(registry.validateBusinessModules(['tasks', 'tasks'], { contextKey: 'fixture_studio' }), ['tasks']);
});

test('HR module is configurable only for the Park and still requires explicit business enablement', () => {
    const parkHr = registry.businessModuleCatalog('event_genix').find(module => module.key === 'hr');
    assert.equal(parkHr.canEnable, true);
    assert.equal(parkHr.status, 'limited');
    assert.deepEqual(registry.validateBusinessModules(['hr'], { contextKey: 'event_genix' }), ['hr']);
    assert.equal(registry.userBusinessModuleState(actor(['hr'], 'event_genix'), 'event_genix', 'hr').available, true);
    assert.equal(registry.userBusinessModuleState(actor([], 'event_genix'), 'event_genix', 'hr').available, false);

    for (const context of ['dar', 'fixture_studio']) {
        const hr = registry.businessModuleCatalog(context).find(module => module.key === 'hr');
        assert.equal(hr.canEnable, false);
        assert.throws(() => registry.validateBusinessModules(['hr'], { contextKey: context }), { code: 'business_module_not_supported' });
        assert.equal(registry.userBusinessModuleState(actor(['hr'], context), context, 'hr').available, false);
    }
});

test('Afisha module is configurable only for the Park and still requires explicit business enablement', () => {
    const parkAfisha = registry.businessModuleCatalog('event_genix').find(module => module.key === 'afisha');
    assert.equal(parkAfisha.canEnable, true);
    assert.equal(parkAfisha.status, 'limited');
    assert.deepEqual(registry.validateBusinessModules(['afisha'], { contextKey: 'event_genix' }), ['afisha']);
    assert.equal(registry.userBusinessModuleState(actor(['afisha'], 'event_genix'), 'event_genix', 'afisha').available, true);
    assert.equal(registry.userBusinessModuleState(actor([], 'event_genix'), 'event_genix', 'afisha').available, false);
    const cabinet = { context: 'event_genix', timeline: { enabledModules: { afisha: false } } };
    assert.equal(businessCabinetForUser(cabinet, actor(['timeline', 'afisha'], 'event_genix')).timeline.enabledModules.afisha, true);
    assert.equal(businessCabinetForUser(cabinet, actor(['timeline'], 'event_genix')).timeline.enabledModules.afisha, false);

    for (const context of ['dar', 'fixture_studio']) {
        const afisha = registry.businessModuleCatalog(context).find(module => module.key === 'afisha');
        assert.equal(afisha.canEnable, false);
        assert.throws(() => registry.validateBusinessModules(['afisha'], { contextKey: context }), { code: 'business_module_not_supported' });
        assert.equal(registry.userBusinessModuleState(actor(['afisha'], context), context, 'afisha').available, false);
    }
});

test('scoped chat requires explicit business enablement and Guardian review stays manager-only', () => {
    for (const context of ['event_genix', 'dar', 'fixture_studio']) {
        const chat = registry.businessModuleCatalog(context).find(module => module.key === 'chat');
        assert.equal(chat.status, 'limited');
        assert.equal(chat.canEnable, true);
        assert.deepEqual(registry.validateBusinessModules(['chat'], { contextKey: context }), ['chat']);
        assert.equal(registry.userBusinessModuleState(actor(['chat'], context), context, 'chat').available, true);
        assert.equal(registry.userBusinessModuleState(actor([], context), context, 'chat').available, false);
        assert.equal(registry.canReviewBusinessGuardian(actor(['chat'], context, 'director'), context), true);
        assert.equal(registry.canReviewBusinessGuardian(actor(['chat'], context, 'animator'), context), false);
        assert.equal(registry.canReviewBusinessGuardian(actor([], context, 'director'), context), false);
    }
});

test('module capability does not grant an employee settings permission or bypass revoked membership', () => {
    const user = actor(['timeline'], 'fixture_studio', 'animator');
    assert.equal(registry.userBusinessModuleState(user, 'fixture_studio', 'timeline').available, true);
    assert.equal(canUseTimelineAction(user, 'fixture_studio', 'settings'), false);
    user.businessMembershipAccess.memberships = [];
    assert.equal(registry.userBusinessModuleState(user, 'fixture_studio', 'timeline').available, false);
    assert.equal(canUseTimelineAction(user, 'fixture_studio', 'settings'), false);
});

test('operational API guard checks every aggregate business and retains dedicated containment and recovery paths', () => {
    const user = actor(['tasks']);
    user.businessMembershipAccess.memberships.push({ ...user.businessMembershipAccess.memberships[0], businessContext: 'fixture_second', businessModules: [] });
    const scope = { activeContext: 'fixture_studio', selectedContexts: ['fixture_studio', 'fixture_second'] };
    const result = {};
    const res = { status(value) { result.status = value; return this; }, json(value) { result.body = value; } };
    for (const path of ['/api/tasks', '/api/v1/TASKS/17', '/api/%74asks']) {
        assert.equal(registry.requireRequestBusinessModule({ originalUrl: path, user }, res, scope), false);
        assert.equal(result.status, 403);
        assert.equal(result.body.businessContext, 'fixture_second');
    }
    assert.equal(registry.requireRequestBusinessModule({ originalUrl: '/api/tasks', user }, res, { ...scope, selectedContexts: ['fixture_studio'] }), true);
    assert.equal(registry.requestBusinessModule({ originalUrl: '/api/organizations/management' }), null);
    assert.equal(registry.requestBusinessModule({ originalUrl: '/api/finance/report/salary' }), null);
    assert.equal(registry.requestBusinessModule({ originalUrl: '/api/catalogs' }), null);
});

test('custom profile branding, start route and empty recovery come from the registry with read-only settings access', async () => {
    const queries = [];
    const db = { async query(sql) { queries.push(sql); assert.match(sql, /^SELECT /); return { rows: [] }; } };
    const user = actor(['timeline', 'tasks']);
    const profile = await buildBusinessOperatingProfile(db, user, { includeIntegrations: false });
    assert.equal(profile.activeProfile.label, 'Registry name');
    assert.equal(profile.activeProfile.shortLabel, 'Registry short');
    assert.equal(profile.activeProfile.startPagePath, '/?businessContext=fixture_studio');
    assert.equal(profile.activeProfile.timeline.mode, 'simple');
    assert.equal(profile.activeProfile.modules.enabled.graduation, false);
    const empty = await buildBusinessOperatingProfile(db, actor([]), { includeIntegrations: false });
    assert.equal(empty.activeProfile.startPagePath, '/profile');
    assert.deepEqual(empty.activeProfile.modules.enabledIds, []);
    assert.equal(empty.activeProfile.shell.timelineEnabled, false);
    assert.ok(queries.length > 0);
});
