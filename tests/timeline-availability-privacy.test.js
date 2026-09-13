'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { timelineResourceAvailability } = require('../services/timelineResources');

const director = { id: 17, username: 'availability_actor', role: 'director' };

function fixture(rows) {
    const queries = [];
    return { queries, async query(sql, params) {
        queries.push({ sql: String(sql), params });
        if (/SELECT COUNT\(\*\)::int AS count FROM timeline_resources/.test(sql)) return { rows: [{ count: 1 }] };
        if (/SELECT \*\s+FROM timeline_resources/.test(sql)) return { rows: [{ id: 1,
            business_context: 'event_genix', resource_id: 'room-test', type: 'room', name: 'Fixture room',
            capacity: 8, is_active: true, metadata: {} }] };
        if (/FROM bookings b/.test(sql)) return { rows };
        throw new Error('Unexpected availability query');
    } };
}

function booking(overrides = {}) {
    return { id: 'private-booking', line_id: 'room-test', room_resource_id: 'room-test', room: 'Fixture room',
        time: '10:00', duration: 60, label: 'Private label', program_name: 'Private program', kids_count: 5,
        customer_name: 'Private customer', customer_id: 81, business_context: 'event_genix',
        banquet_group_id: 'private-banquet', banquet_group_primary_booking_id: 'private-primary',
        banquet_group_customer_id: 82, extra_data: { timelineResourceBlock: { resourceBlocked: true } },
        actor_can_view: false, ...overrides };
}

function availability(db, options = {}) {
    return timelineResourceAvailability(db, { context: 'event_genix', type: 'room', date: '2026-09-12',
        time: '10:30', duration: 30, actor: director, ...options });
}

test('hidden conflicts keep resource occupied with opaque entries and unchanged capacity', async () => {
    const db = fixture([booking()]);
    const result = await availability(db, { capacity: 9 });
    assert.deepEqual(result.free, []);
    assert.deepEqual(result.occupied, ['Fixture room']);
    const resource = result.resources[0];
    assert.equal(resource.occupied, true);
    assert.equal(resource.capacityAvailable, false);
    assert.equal(resource.unavailableReason, 'occupied');
    assert.deepEqual(resource.bookings, [{ time: '10:00', duration: 60, unavailable: true }]);
    assert.deepEqual(resource.dayBookings, resource.bookings);
    assert.doesNotMatch(JSON.stringify(result), /private-|Private|customerId|banquetGroup|kidsCount|resourceBlock/);
});

test('hidden day bookings remain generic outside requested interval and linked children only block overlap', async () => {
    const db = fixture([booking(), booking({ id: 'private-child', time: '12:00', linked_to: 'private-parent' })]);
    const free = await availability(db, { time: '11:00', duration: 60 });
    assert.deepEqual(free.free, ['Fixture room']);
    assert.deepEqual(free.resources[0].dayBookings, [{ time: '10:00', duration: 60, unavailable: true }]);
    const occupied = await availability(db, { time: '12:00' });
    assert.equal(occupied.resources[0].occupied, true);
    assert.deepEqual(occupied.resources[0].bookings, [{ time: '12:00', duration: 60, unavailable: true }]);
});

test('canonical SQL visibility is projected while all bookings remain in the collision query', async () => {
    const db = fixture([booking({ actor_can_view: true })]);
    const result = await availability(db, { actor: { id: 17, role: 'animator', username: 'availability_actor' } });
    assert.equal(result.resources[0].dayBookings[0].id, 'private-booking');
    assert.equal(result.resources[0].dayBookings[0].customerName, 'Private customer');
    const query = db.queries.find(item => /FROM bookings b/.test(item.sql));
    const [projection, predicate] = query.sql.split(/\n\s+WHERE b.date/);
    assert.match(projection, /actor_can_view/);
    assert.match(projection, /employee_profiles/);
    assert.match(projection, /b\.created_by IN/);
    assert.ok(query.params.includes('availability_actor'));
    assert.doesNotMatch(predicate, /employee_profiles|b\.created_by|actor_can_view/);
});

test('missing actor or mismatched active membership cannot disclose detail even on a permissive row', async () => {
    for (const actor of [undefined, { ...director, businessMembershipAccess: { membershipEnabled: true,
        businessContexts: ['event_genix', 'dar'] }, activeBusinessMembership: { businessContext: 'dar' } }]) {
        const db = fixture([booking({ actor_can_view: true })]);
        const result = await availability(db, { actor });
        assert.deepEqual(result.resources[0].bookings, [{ time: '10:00', duration: 60, unavailable: true }]);
        assert.match(db.queries.find(item => /FROM bookings b/.test(item.sql)).sql, /\(FALSE\) AS actor_can_view/);
    }
});
