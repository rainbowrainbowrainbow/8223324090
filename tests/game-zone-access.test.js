'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');
const { resolveCapability } = require('../services/accountAccessPolicy');
const { buildTimelineBookingVisibilityScope, canViewTimelineBooking, canEditBooking } = require('../services/bookingVisibility');

function actor(role = 'instructor', overrides = {}) {
    const member = { organization_id: 1, business_id: 1, context_key: 'event_genix', access_mode: 'membership',
        role, is_default: true, business_modules: ['timeline'], ...overrides };
    return applyMembershipAccess({ id: 8, role: 'creator' }, buildMembershipAccess({}, [member], 'event_genix'));
}

test('approved game-zone capability opens classified reads without mutation/contact/revenue grants', () => {
    for (const role of ['instructor', 'senior_instructor']) {
        const user = { ...actor(role), gameZoneResourceIds: ['zone-a'] };
        assert.equal(resolveCapability(user, 'timeline.game_zones.view').allowed, true);
        const booking = { id: 'zone-event', business_context: 'event_genix', room_resource_id: 'zone-a' };
        assert.equal(canViewTimelineBooking(user, booking), true);
        assert.equal(canViewTimelineBooking(user, { ...booking, room_resource_id: 'other' }), false);
        assert.equal(canViewTimelineBooking(user, { ...booking, business_context: 'dar' }), false);
        assert.equal(canEditBooking(user, booking), false);
        for (const action of ['create_booking', 'delete_booking', 'bookings.contacts.view', 'view_revenue', 'export_data']) {
            assert.equal(resolveCapability(user, action).allowed, false, action);
        }
        const params = ['2026-11-18', 'event_genix'];
        const sql = buildTimelineBookingVisibilityScope(user, params, 'b', 'event_genix');
        assert.match(sql, /b\.room_resource_id = ANY\(\$3::text\[\]\)/);
        assert.deepEqual(params[2], ['zone-a']);
    }
});

test('zone lookup requires current membership, available timeline and explicit capability; discards supplied IDs', async () => {
    const { loadGameZoneAccess, loadGameZoneResourceIds } = require('../services/gameZoneAccess');
    const queries = [];
    const db = { async query(sql, params) { queries.push({ sql, params }); return { rows: [{ resource_id: 'zone-a' }] }; } };
    assert.deepEqual(await loadGameZoneResourceIds(db, actor(), 'event_genix'), ['zone-a']);
    assert.match(queries[0].sql, /type = 'room' AND is_active IS TRUE/);
    assert.match(queries[0].sql, /metadata->>'workArea' = 'game_zone'/);
    assert.deepEqual(queries[0].params, ['event_genix']);
    for (const user of [actor('instructor', { action_denylist: ['timeline.game_zones.view'] }),
        actor('instructor', { page_denylist: ['/'] }), actor('instructor', { business_modules: [] }),
        { role: 'instructor' }, { ...actor(), businessMembershipAccess: { invalid: true } }]) {
        assert.deepEqual(await loadGameZoneResourceIds(db, user, 'event_genix'), []);
        assert.equal(canViewTimelineBooking({ ...user, gameZoneResourceIds: ['zone-a'] },
            { id: 'z', business_context: 'event_genix', room_resource_id: 'zone-a' }), false);
    }
    assert.deepEqual(await loadGameZoneResourceIds(db, actor(), 'dar'), []);
    assert.equal(queries.length, 1);
    const req = { user: { role: 'cook', gameZoneResourceIds: ['forged'] }, query: {}, method: 'GET' };
    let nextCalled = false;
    await loadGameZoneAccess(req, {}, error => { assert.equal(error, undefined); nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.deepEqual(req.user.gameZoneResourceIds, []);
});

test('additional roles and independent scopes remain additive while explicit denials win', () => {
    const booking = { id: 'z', business_context: 'event_genix', room_resource_id: 'zone-a' };
    const extra = { ...actor('cook', { extra_roles: ['instructor'], page_allowlist: ['/'] }), gameZoneResourceIds: ['zone-a'] };
    assert.equal(canViewTimelineBooking(extra, booking), true);
    assert.equal(canViewTimelineBooking({ ...actor('instructor', { action_denylist: ['timeline.game_zones.view'] }),
        gameZoneResourceIds: ['zone-a'] }, booking), false);
    assert.equal(canViewTimelineBooking({ ...actor('instructor', { action_denylist: ['timeline.game_zones.view'] }), staffIds: [7] },
        { id: 'own-assignment', business_context: 'event_genix', line_id: '7' }), true, 'existing staff assignments stay readable');
    const shared = { ...actor('instructor', { extra_roles: ['animator'] }), gameZoneResourceIds: ['zone-a'] };
    assert.equal(buildTimelineBookingVisibilityScope(shared, [], 'b', 'event_genix'), '', 'independent animator shared read survives');
});

test('room catalogs filter to active classified Park zones without changing independent broad scopes', () => {
    const { filterGameZoneResources } = require('../services/gameZoneAccess');
    const good = { resourceId: 'zone-a', type: 'room', businessContext: 'event_genix', isActive: true, metadata: { workArea: 'game_zone' } };
    const resources = [good, { ...good, resourceId: 'inactive', isActive: false },
        { ...good, resourceId: 'foreign', businessContext: 'dar' }, { ...good, resourceId: 'not-room', type: 'animator' },
        { ...good, resourceId: 'label-only', name: 'Game zone', metadata: {} }];
    assert.deepEqual(filterGameZoneResources(actor(), 'event_genix', resources), [good]);
    assert.deepEqual(filterGameZoneResources(actor('instructor', { action_denylist: ['timeline.game_zones.view'] }), 'event_genix', resources), []);
    assert.deepEqual(filterGameZoneResources(actor('instructor', { extra_roles: ['director'] }), 'event_genix', resources), resources);
});
