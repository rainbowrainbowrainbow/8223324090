'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');
const { canReadParkStaffSchedule } = require('../services/parkStaffScheduleAccess');

const contexts = ['event_genix', 'dar', 'crm', 'foreign_business'];
const principal = { id: 81, username: 'schedule_access_fixture', role: 'director',
    business_contexts: contexts, default_business_context: 'event_genix' };
const registry = (context, extra = {}) => ({ business_id: contexts.indexOf(context) + 1,
    organization_id: context === 'foreign_business' ? 2 : 1, context_key: context,
    access_mode: 'membership', business_status: 'active', organization_status: 'active', ...extra });
const membership = (context, extra = {}) => ({ ...registry(context), role: 'director', organization_role: 'owner',
    business_modules: [], is_default: context === 'event_genix', ...extra });

function request(context = 'event_genix', options = {}) {
    const actor = options.principal || principal;
    const user = applyMembershipAccess(actor, buildMembershipAccess(actor,
        options.memberships || contexts.map(context => membership(context)), context,
        options.registry || contexts.map(context => registry(context))));
    return { user, method: 'GET', path: '/schedule', headers: { 'x-business-context': context },
        query: {}, body: {}, ...options.request };
}

test('Park membership can read only the schedule dependencies without enabling the whole HR module', () => {
    for (const path of ['/', '/departments', '/display-groups', '/schedule', '/schedule/', '/schedule/hours',
        '/attendance', '/schedule/history/12/2026-09-14']) {
        assert.equal(canReadParkStaffSchedule(request('event_genix', { request: { path } }), 'staff'), true, path);
    }
    const professions = request('event_genix', { request: { path: '/professions' } });
    assert.equal(canReadParkStaffSchedule(professions, 'hr'), true);
    assert.equal(canReadParkStaffSchedule(professions, 'staff'), false);
    assert.equal(canReadParkStaffSchedule(request(), 'hr'), false);
    assert.equal(canReadParkStaffSchedule(request(), null), false);
});

test('all mutation verbs, HEAD and unrelated staff/HR reads remain contained', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
        for (const [routerId, path] of [['staff', '/schedule'], ['staff', '/'], ['hr', '/professions']]) {
            assert.equal(canReadParkStaffSchedule(request('event_genix', { request: { method, path } }), routerId), false, `${method} ${path}`);
        }
    }
    for (const path of ['/payroll', '/face-descriptors', '/checkins', '/link-status', '/account-stats', '/12',
        '/12/shift-preferences', '/schedule/check/2026-09-14', '/schedule/export-xlsx', '/schedule/bulk',
        '/schedule/history/12/2026-09-14/extra', '/schedule/history/-1/2026-09-14']) {
        assert.equal(canReadParkStaffSchedule(request('event_genix', { request: { path } }), 'staff'), false, path);
    }
    for (const path of ['/staff', '/shifts', '/shift-templates', '/professions/workspace/1', '/professions/animator/checklist']) {
        assert.equal(canReadParkStaffSchedule(request('event_genix', { request: { path } }), 'hr'), false, path);
    }
});

test('other businesses and cross-business scope cannot borrow Park membership', () => {
    for (const context of contexts.slice(1)) assert.equal(canReadParkStaffSchedule(request(context), 'staff'), false, context);
    const members = ['event_genix', 'dar'].map(context => membership(context));
    const businesses = ['event_genix', 'dar'].map(context => registry(context));
    for (const mode of ['all', 'multi']) {
        const req = request('event_genix', { memberships: members, registry: businesses });
        req.query = { businessScope: mode, businessContexts: 'event_genix,dar' };
        assert.equal(canReadParkStaffSchedule(req, 'staff'), false, mode);
    }
    for (const query of [{ businessContext: 'dar' }, { business_context: 'crm' }]) {
        assert.equal(canReadParkStaffSchedule(request('event_genix', { request: { query } }), 'staff'), false);
    }
});

test('revoked membership, inactive organization/business and absent server authority fail closed', () => {
    assert.equal(canReadParkStaffSchedule(request('event_genix', { memberships: [] }), 'staff'), false);
    for (const extra of [{ business_status: 'inactive' }, { organization_status: 'inactive' }]) {
        const req = request('event_genix', { registry: [registry('event_genix', extra)] });
        assert.equal(canReadParkStaffSchedule(req, 'staff'), false);
    }
    for (const change of [
        req => { req.user = null; },
        req => { delete req.user.businessMembershipAccess; },
        req => { delete req.user.activeBusinessMembership; },
        req => { req.user.businessMembershipAccess.invalid = true; },
        req => { req.user.businessMembershipAccess.activeMembership = null; },
        req => { req.user.businessMembershipAccess.membershipEnabled = false; }
    ]) {
        const req = request();
        change(req);
        assert.equal(canReadParkStaffSchedule(req, 'staff'), false);
    }
});

test('registry, membership and resolved active business must agree on their organization and business IDs', () => {
    for (const change of [
        req => { req.user.businessMembershipAccess.registry[0].organizationId = 999; },
        req => { req.user.businessMembershipAccess.registry[0].businessId = 999; },
        req => { req.user.businessMembershipAccess.registry[0].accessMode = 'compatibility'; },
        req => { req.user.businessMembershipAccess.registry[0].businessId = null; },
        req => { req.user.activeBusinessMembership = { ...req.user.activeBusinessMembership, businessContext: 'dar' }; },
        req => { req.user.businessMembershipAccess.registry.push({ ...req.user.businessMembershipAccess.registry[0] }); },
        req => { req.user.businessMembershipAccess.memberships.push({ ...req.user.activeBusinessMembership }); }
    ]) {
        const req = request();
        change(req);
        assert.equal(canReadParkStaffSchedule(req, 'staff'), false);
    }
});

test('membership role and explicit capability denies are preserved without a platform-creator bypass', () => {
    const denied = request('event_genix', { memberships: [membership('event_genix', { action_denylist: ['hr.schedule.view'] })] });
    assert.equal(canReadParkStaffSchedule(denied, 'staff'), false);
    const creator = { ...principal, role: 'creator' };
    const narrow = request('event_genix', { principal: creator,
        memberships: [membership('event_genix', { role: 'animator', action_denylist: ['hr.schedule.view'] })] });
    assert.equal(narrow.user.platformRole, 'creator');
    assert.equal(narrow.user.role, 'animator');
    assert.equal(canReadParkStaffSchedule(narrow, 'staff'), false);
});
