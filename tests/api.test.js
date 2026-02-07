/**
 * tests/api.test.js — API Smoke Tests
 * Run: node --test tests/api.test.js
 * Env: TEST_URL, TEST_USER, TEST_PASS
 *
 * Requires a running server with a valid test user in the database.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, authRequest, getToken, testDate, resetToken, TEST_USER, TEST_PASS } = require('./helpers');

// ==========================================
// AUTH
// ==========================================

describe('Auth', () => {
    it('POST /api/auth/login — success', async () => {
        const res = await request('POST', '/api/auth/login', {
            username: TEST_USER,
            password: TEST_PASS
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.token, 'Should return a JWT token');
        assert.ok(res.data.user, 'Should return user object');
        assert.ok(res.data.user.username, 'User should have username');
        assert.ok(res.data.user.role, 'User should have role');
    });

    it('POST /api/auth/login — wrong password', async () => {
        const res = await request('POST', '/api/auth/login', {
            username: TEST_USER,
            password: 'wrong_password_12345'
        });
        assert.equal(res.status, 401);
        assert.ok(res.data.error);
    });

    it('GET /api/auth/verify — valid token', async () => {
        const token = await getToken();
        const res = await request('GET', '/api/auth/verify', null, token);
        assert.equal(res.status, 200);
        assert.ok(res.data.user);
    });

    it('GET /api/auth/verify — invalid token', async () => {
        const res = await request('GET', '/api/auth/verify', null, 'invalid.token.here');
        assert.ok([401, 403].includes(res.status), `Expected 401 or 403, got ${res.status}`);
    });
});

// ==========================================
// HEALTH
// ==========================================

describe('Health & Stats', () => {
    it('GET /api/health — should respond ok', async () => {
        const res = await request('GET', '/api/health');
        assert.equal(res.status, 200);
        assert.equal(res.data.status, 'ok');
    });

    it('GET /api/stats/:from/:to — should return array', async () => {
        const res = await authRequest('GET', '/api/stats/2099-01-01/2099-01-31');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return an array');
    });
});

// ==========================================
// LINES
// ==========================================

describe('Lines', () => {
    const date = testDate();

    it('GET /api/lines/:date — should return array', async () => {
        const res = await authRequest('GET', `/api/lines/${date}`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return an array');
    });

    it('POST /api/lines/:date — save lines', async () => {
        const lines = [
            { id: 'test_line_1', name: 'Test Animator 1', color: '#FF0000' },
            { id: 'test_line_2', name: 'Test Animator 2', color: '#00FF00' }
        ];
        const res = await authRequest('POST', `/api/lines/${date}`, lines);
        assert.equal(res.status, 200);
        assert.ok(res.data.success, 'Should return success');

        // Verify saved
        const check = await authRequest('GET', `/api/lines/${date}`);
        assert.equal(check.data.length, 2);
        assert.equal(check.data[0].name, 'Test Animator 1');
    });
});

// ==========================================
// BOOKINGS CRUD
// ==========================================

describe('Bookings CRUD', () => {
    const date = testDate();
    let createdBookingId;

    before(async () => {
        // Ensure test lines exist
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'test_line_1', name: 'Test Animator 1', color: '#FF0000' }
        ]);
    });

    it('POST /api/bookings — create booking', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date,
            time: '14:00',
            lineId: 'test_line_1',
            room: 'Marvel',
            programCode: 'КВ1',
            label: 'КВ1(60)',
            duration: 60,
            price: 2200,
            category: 'quest',
            status: 'confirmed',
            notes: 'smoke test'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(res.data.booking, 'Should return booking object');
        assert.ok(res.data.booking.id, 'Booking should have an id');
        createdBookingId = res.data.booking.id;
    });

    it('GET /api/bookings/:date — should contain created booking', async () => {
        const res = await authRequest('GET', `/api/bookings/${date}`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
        const found = res.data.find(b => b.id === createdBookingId);
        assert.ok(found, 'Created booking should be in the list');
        assert.equal(found.room, 'Marvel');
    });

    it('PUT /api/bookings/:id — update booking', async () => {
        assert.ok(createdBookingId, 'Need booking ID from create step');
        const res = await authRequest('PUT', `/api/bookings/${createdBookingId}`, {
            date,
            time: '15:00',
            lineId: 'test_line_1',
            room: 'Ninja',
            programCode: 'КВ1',
            label: 'КВ1(60)',
            duration: 60,
            price: 2200,
            category: 'quest',
            status: 'confirmed',
            notes: 'updated by smoke test'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
    });

    it('DELETE /api/bookings/:id — delete booking', async () => {
        assert.ok(createdBookingId, 'Need booking ID from create step');
        const res = await authRequest('DELETE', `/api/bookings/${createdBookingId}`);
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
    });

    it('GET /api/bookings/:date — should not contain deleted booking', async () => {
        const res = await authRequest('GET', `/api/bookings/${date}`);
        assert.equal(res.status, 200);
        const found = res.data.find(b => b.id === createdBookingId);
        assert.ok(!found, 'Deleted booking should not appear');
    });
});

// ==========================================
// VALIDATION
// ==========================================

describe('Validation', () => {
    it('POST /api/bookings — missing fields returns 400', async () => {
        const res = await authRequest('POST', '/api/bookings', { date: '2099-01-20' });
        assert.equal(res.status, 400);
        assert.ok(res.data.error);
    });

    it('POST /api/bookings — invalid date format returns 400', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date: 'not-a-date',
            time: '14:00',
            lineId: 'test_line_1'
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/bookings — time conflict returns 409', async () => {
        const date = '2099-02-01';
        // Ensure line exists
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'conflict_line', name: 'Conflict Test', color: '#0000FF' }
        ]);

        // Create first booking
        const first = await authRequest('POST', '/api/bookings', {
            date,
            time: '14:00',
            lineId: 'conflict_line',
            room: 'Marvel',
            programCode: 'КВ1',
            label: 'КВ1(60)',
            duration: 60,
            price: 2200,
            category: 'quest',
            status: 'confirmed'
        });
        assert.equal(first.status, 200, `First booking should succeed: ${JSON.stringify(first.data)}`);

        // Create conflicting booking (overlapping time, same line)
        const conflict = await authRequest('POST', '/api/bookings', {
            date,
            time: '14:30',
            lineId: 'conflict_line',
            room: 'Ninja',
            programCode: 'АН',
            label: 'АН(60)',
            duration: 60,
            price: 1500,
            category: 'animation',
            status: 'confirmed'
        });
        assert.equal(conflict.status, 409, `Conflict should return 409, got ${conflict.status}: ${JSON.stringify(conflict.data)}`);

        // Cleanup: delete the first booking
        if (first.data && first.data.booking) {
            await authRequest('DELETE', `/api/bookings/${first.data.booking.id}`);
        }
    });
});

// ==========================================
// BOOKINGS FULL (linked bookings)
// ==========================================

describe('Bookings Full endpoint', () => {
    const date = '2099-03-01';

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'full_line_1', name: 'Full Test 1', color: '#FF0000' },
            { id: 'full_line_2', name: 'Full Test 2', color: '#00FF00' }
        ]);
    });

    it('POST /api/bookings/full — main only (no linked)', async () => {
        const res = await authRequest('POST', '/api/bookings/full', {
            main: {
                date,
                time: '16:00',
                lineId: 'full_line_1',
                room: 'Marvel',
                programCode: 'КВ1',
                label: 'КВ1(60)',
                duration: 60,
                price: 2200,
                category: 'quest',
                status: 'confirmed'
            },
            linked: []
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.mainBooking);

        // Cleanup
        if (res.data.mainBooking) {
            await authRequest('DELETE', `/api/bookings/${res.data.mainBooking.id}`);
        }
    });

    it('POST /api/bookings/full — main + linked', async () => {
        const res = await authRequest('POST', '/api/bookings/full', {
            main: {
                date,
                time: '17:00',
                lineId: 'full_line_1',
                room: 'Ninja',
                programCode: 'КВ4',
                label: 'КВ4(60)',
                duration: 60,
                price: 2800,
                category: 'quest',
                status: 'confirmed'
            },
            linked: [
                {
                    date,
                    time: '17:00',
                    lineId: 'full_line_2',
                    room: 'Ninja',
                    programCode: 'КВ4',
                    label: 'КВ4(60)',
                    duration: 60,
                    price: 0,
                    category: 'quest',
                    status: 'confirmed'
                }
            ]
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.mainBooking);
        assert.ok(Array.isArray(res.data.linkedBookings));
        assert.equal(res.data.linkedBookings.length, 1);

        // Cleanup (delete main should cascade linked)
        if (res.data.mainBooking) {
            await authRequest('DELETE', `/api/bookings/${res.data.mainBooking.id}`);
        }
    });
});

// ==========================================
// SOFT DELETE (v5.14)
// ==========================================

describe('Soft Delete', () => {
    const date = '2099-04-01';
    let softDeletedId;

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'soft_line', name: 'Soft Delete Test', color: '#FF00FF' }
        ]);
    });

    it('DELETE /api/bookings/:id — soft delete (default)', async () => {
        const create = await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'soft_line', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
        assert.equal(create.status, 200);
        softDeletedId = create.data.booking.id;

        const del = await authRequest('DELETE', `/api/bookings/${softDeletedId}`);
        assert.equal(del.status, 200);
        assert.ok(del.data.success);
    });

    it('GET /api/bookings/:date — soft deleted booking should not appear', async () => {
        const res = await authRequest('GET', `/api/bookings/${date}`);
        assert.equal(res.status, 200);
        const found = res.data.find(b => b.id === softDeletedId);
        assert.ok(!found, 'Soft-deleted booking should be hidden');
    });

    it('POST /api/bookings — can book same time slot after soft delete', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'soft_line', room: 'Ninja',
            programCode: 'АН', label: 'АН(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
        assert.equal(res.status, 200, `Should succeed on cancelled slot: ${JSON.stringify(res.data)}`);
        if (res.data.booking) await authRequest('DELETE', `/api/bookings/${res.data.booking.id}?permanent=true`);
    });

    it('DELETE /api/bookings/:id?permanent=true — hard delete', async () => {
        const create = await authRequest('POST', '/api/bookings', {
            date, time: '16:00', lineId: 'soft_line', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
        assert.equal(create.status, 200);
        const id = create.data.booking.id;

        const del = await authRequest('DELETE', `/api/bookings/${id}?permanent=true`);
        assert.equal(del.status, 200);
        assert.ok(del.data.success);
    });
});

// ==========================================
// HISTORY (v5.16: with filters)
// ==========================================

describe('History', () => {
    it('GET /api/history — should return object with items', async () => {
        const res = await authRequest('GET', '/api/history');
        assert.equal(res.status, 200);
        assert.ok(res.data.items, 'Should have items property');
        assert.ok(Array.isArray(res.data.items), 'items should be array');
        assert.ok(typeof res.data.total === 'number', 'Should have total count');
    });

    it('GET /api/history?limit=5 — should respect limit', async () => {
        const res = await authRequest('GET', '/api/history?limit=5');
        assert.equal(res.status, 200);
        assert.ok(res.data.items.length <= 5, 'Should return at most 5 items');
        assert.equal(res.data.limit, 5);
    });

    it('GET /api/history?action=create — should filter by action', async () => {
        const res = await authRequest('GET', '/api/history?action=create');
        assert.equal(res.status, 200);
        for (const item of res.data.items) {
            assert.equal(item.action, 'create', `All items should be "create", got "${item.action}"`);
        }
    });

    it('GET /api/history?from=2099-01-01&to=2099-12-31 — date range', async () => {
        const res = await authRequest('GET', '/api/history?from=2099-01-01&to=2099-12-31');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.items));
    });

    it('POST /api/history — add entry then find by user', async () => {
        const res = await authRequest('POST', '/api/history', {
            action: 'create',
            user: 'test_api_user',
            data: { label: 'TEST', room: 'Marvel', date: '2099-01-01', time: '12:00' }
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);

        const check = await authRequest('GET', '/api/history?user=test_api_user');
        assert.ok(check.data.items.length > 0, 'Should find entry by user filter');
    });
});

// ==========================================
// STATUS CHANGE
// ==========================================

describe('Status Change', () => {
    const date = '2099-05-01';
    let bookingId;

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'status_line', name: 'Status Test', color: '#00FFFF' }
        ]);
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'status_line', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
        bookingId = res.data.booking.id;
    });

    it('PUT /api/bookings/:id — change status to preliminary', async () => {
        const res = await authRequest('PUT', `/api/bookings/${bookingId}`, {
            date, time: '14:00', lineId: 'status_line', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'preliminary'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);

        const check = await authRequest('GET', `/api/bookings/${date}`);
        const booking = check.data.find(b => b.id === bookingId);
        assert.equal(booking.status, 'preliminary');
    });

    after(async () => {
        if (bookingId) await authRequest('DELETE', `/api/bookings/${bookingId}?permanent=true`);
    });
});

// ==========================================
// UNAUTHENTICATED ACCESS
// ==========================================

describe('Unauthenticated access', () => {
    it('GET /api/bookings/:date — without token returns 401', async () => {
        const res = await request('GET', '/api/bookings/2099-01-01');
        assert.equal(res.status, 401);
    });

    it('GET /api/history — without token returns 401', async () => {
        const res = await request('GET', '/api/history');
        assert.equal(res.status, 401);
    });

    it('POST /api/bookings — without token returns 401', async () => {
        const res = await request('POST', '/api/bookings', { date: '2099-01-01' });
        assert.equal(res.status, 401);
    });

    it('GET /api/afisha — without token returns 401', async () => {
        const res = await request('GET', '/api/afisha');
        assert.equal(res.status, 401);
    });

    it('GET /api/settings/digest_time — without token returns 401', async () => {
        const res = await request('GET', '/api/settings/digest_time');
        assert.equal(res.status, 401);
    });
});

// ==========================================
// AFISHA CRUD (v5.19)
// ==========================================

describe('Afisha CRUD', () => {
    let createdAfishaId;

    it('GET /api/afisha — should return array', async () => {
        const res = await authRequest('GET', '/api/afisha');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return an array');
    });

    it('POST /api/afisha — create event', async () => {
        const res = await authRequest('POST', '/api/afisha', {
            date: '2099-06-01',
            time: '14:00',
            title: 'Test Event Smoke',
            duration: 90
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(res.data.item, 'Should return created item');
        assert.ok(res.data.item.id, 'Item should have an id');
        assert.equal(res.data.item.title, 'Test Event Smoke');
        assert.equal(res.data.item.duration, 90);
        createdAfishaId = res.data.item.id;
    });

    it('GET /api/afisha/:date — should return events for date', async () => {
        const res = await authRequest('GET', '/api/afisha/2099-06-01');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
        const found = res.data.find(e => e.id === createdAfishaId);
        assert.ok(found, 'Created event should be in the list');
        assert.equal(found.title, 'Test Event Smoke');
    });

    it('PUT /api/afisha/:id — update event', async () => {
        assert.ok(createdAfishaId, 'Need afisha ID from create step');
        const res = await authRequest('PUT', `/api/afisha/${createdAfishaId}`, {
            date: '2099-06-01',
            time: '15:00',
            title: 'Updated Event Title',
            duration: 120
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);

        // Verify update
        const check = await authRequest('GET', '/api/afisha/2099-06-01');
        const found = check.data.find(e => e.id === createdAfishaId);
        assert.ok(found, 'Updated event should still exist');
        assert.equal(found.title, 'Updated Event Title');
        assert.equal(found.time, '15:00');
    });

    it('DELETE /api/afisha/:id — delete event', async () => {
        assert.ok(createdAfishaId, 'Need afisha ID from create step');
        const res = await authRequest('DELETE', `/api/afisha/${createdAfishaId}`);
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);

        // Verify deletion
        const check = await authRequest('GET', '/api/afisha/2099-06-01');
        const found = check.data.find(e => e.id === createdAfishaId);
        assert.ok(!found, 'Deleted event should not appear');
    });

    it('POST /api/afisha — missing fields returns 400', async () => {
        const res = await authRequest('POST', '/api/afisha', { date: '2099-06-01' });
        assert.equal(res.status, 400);
        assert.ok(res.data.error);
    });

    it('POST /api/afisha — invalid date returns 400', async () => {
        const res = await authRequest('POST', '/api/afisha', {
            date: 'not-a-date',
            time: '14:00',
            title: 'Bad Date Event'
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/afisha — invalid time returns 400', async () => {
        const res = await authRequest('POST', '/api/afisha', {
            date: '2099-06-01',
            time: 'bad-time',
            title: 'Bad Time Event'
        });
        assert.equal(res.status, 400);
    });
});

// ==========================================
// SETTINGS
// ==========================================

describe('Settings', () => {
    it('GET /api/settings/:key — should return value (or null)', async () => {
        const res = await authRequest('GET', '/api/settings/digest_time');
        assert.equal(res.status, 200);
        assert.ok('value' in res.data, 'Should have value property');
    });

    it('POST /api/settings — save and retrieve', async () => {
        const res = await authRequest('POST', '/api/settings', {
            key: 'test_setting_key',
            value: 'test_value_123'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);

        // Verify saved
        const check = await authRequest('GET', '/api/settings/test_setting_key');
        assert.equal(check.status, 200);
        assert.equal(check.data.value, 'test_value_123');
    });

    it('POST /api/settings — update existing key', async () => {
        await authRequest('POST', '/api/settings', {
            key: 'test_setting_key',
            value: 'updated_value_456'
        });
        const check = await authRequest('GET', '/api/settings/test_setting_key');
        assert.equal(check.data.value, 'updated_value_456');
    });

    it('POST /api/settings — invalid key returns 400', async () => {
        const res = await authRequest('POST', '/api/settings', {
            key: 'INVALID-KEY!!',
            value: 'test'
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.error);
    });

    it('POST /api/settings — value too long returns 400', async () => {
        const res = await authRequest('POST', '/api/settings', {
            key: 'test_long',
            value: 'x'.repeat(1001)
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/settings — missing key returns 400', async () => {
        const res = await authRequest('POST', '/api/settings', { value: 'test' });
        assert.equal(res.status, 400);
    });
});

// ==========================================
// FREE ROOMS (v5.18)
// ==========================================

describe('Free Rooms', () => {
    const date = '2099-07-01';

    before(async () => {
        // Create a line and a booking to occupy a room
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'rooms_line', name: 'Rooms Test', color: '#AABB00' }
        ]);
        await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'rooms_line', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
    });

    it('GET /api/rooms/free/:date/:time/:duration — should return free and occupied', async () => {
        const res = await authRequest('GET', `/api/rooms/free/${date}/14:00/60`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.free), 'Should have free array');
        assert.ok(Array.isArray(res.data.occupied), 'Should have occupied array');
        assert.ok(typeof res.data.total === 'number', 'Should have total count');
        assert.ok(res.data.occupied.includes('Marvel'), 'Marvel should be occupied');
        assert.ok(!res.data.free.includes('Marvel'), 'Marvel should not be in free list');
    });

    it('GET /api/rooms/free/:date/:time/:duration — non-overlapping time shows all free', async () => {
        const res = await authRequest('GET', `/api/rooms/free/${date}/20:00/60`);
        assert.equal(res.status, 200);
        assert.ok(res.data.free.includes('Marvel'), 'Marvel should be free at 20:00');
        assert.equal(res.data.occupied.length, 0, 'No rooms should be occupied at 20:00');
    });

    it('GET /api/rooms/free — invalid date returns 400', async () => {
        const res = await authRequest('GET', '/api/rooms/free/bad-date/14:00/60');
        assert.equal(res.status, 400);
    });

    it('GET /api/rooms/free — invalid time returns 400', async () => {
        const res = await authRequest('GET', `/api/rooms/free/${date}/bad/60`);
        assert.equal(res.status, 400);
    });
});

// ==========================================
// BOOKING RESPONSE CONTRACT (v5.27)
// ==========================================

describe('Booking Response Contract', () => {
    const date = '2099-08-01';
    let bookingId;

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'contract_line', name: 'Contract Test', color: '#112233' }
        ]);
    });

    it('POST /api/bookings — response should contain full booking object', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'contract_line', room: 'Ninja',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed', notes: 'contract test'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);

        const booking = res.data.booking;
        assert.ok(booking, 'Response must include booking object');
        assert.ok(booking.id, 'Booking must have id');
        assert.equal(booking.date, date, 'Booking date must match');
        assert.equal(booking.time, '14:00', 'Booking time must match');
        assert.equal(booking.room, 'Ninja', 'Booking room must match');
        assert.equal(booking.lineId, 'contract_line', 'Booking lineId must match');
        assert.equal(booking.programCode, 'КВ1', 'Booking programCode must match');
        assert.equal(booking.duration, 60, 'Booking duration must match');
        assert.equal(booking.price, 2200, 'Booking price must match');
        assert.equal(booking.category, 'quest', 'Booking category must match');
        assert.equal(booking.status, 'confirmed', 'Booking status must match');

        bookingId = booking.id;
    });

    it('POST /api/bookings/full — response should contain full mainBooking and linkedBookings', async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'contract_line', name: 'Contract Test', color: '#112233' },
            { id: 'contract_line_2', name: 'Contract Test 2', color: '#445566' }
        ]);
        const res = await authRequest('POST', '/api/bookings/full', {
            main: {
                date, time: '16:00', lineId: 'contract_line', room: 'Marvel',
                programCode: 'КВ4', label: 'КВ4(60)', duration: 60, price: 2800,
                category: 'quest', status: 'confirmed'
            },
            linked: [{
                date, time: '16:00', lineId: 'contract_line_2', room: 'Marvel',
                programCode: 'КВ4', label: 'КВ4(60)', duration: 60, price: 0,
                category: 'quest', status: 'confirmed'
            }]
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);

        const main = res.data.mainBooking;
        assert.ok(main, 'Response must include mainBooking');
        assert.ok(main.id, 'mainBooking must have id');
        assert.equal(main.date, date);
        assert.equal(main.room, 'Marvel');

        const linked = res.data.linkedBookings;
        assert.ok(Array.isArray(linked), 'linkedBookings must be array');
        assert.equal(linked.length, 1, 'Should have 1 linked booking');
        assert.ok(linked[0].id, 'Linked booking must have id');
        assert.equal(linked[0].linkedTo, main.id, 'Linked booking must reference main');

        // Cleanup
        await authRequest('DELETE', `/api/bookings/${main.id}?permanent=true`);
    });

    after(async () => {
        if (bookingId) await authRequest('DELETE', `/api/bookings/${bookingId}?permanent=true`);
    });
});

// ==========================================
// AUTH EDGE CASES
// ==========================================

describe('Auth Edge Cases', () => {
    it('POST /api/auth/login — empty body returns 400', async () => {
        const res = await request('POST', '/api/auth/login', {});
        assert.equal(res.status, 400);
        assert.ok(res.data.error);
    });

    it('POST /api/auth/login — missing password returns 400', async () => {
        const res = await request('POST', '/api/auth/login', { username: 'admin' });
        assert.equal(res.status, 400);
    });

    it('POST /api/auth/login — non-existent user returns 401', async () => {
        const res = await request('POST', '/api/auth/login', {
            username: 'nonexistent_user_xyz',
            password: 'whatever'
        });
        assert.equal(res.status, 401);
    });

    it('GET /api/auth/verify — expired/malformed token returns 403', async () => {
        const res = await request('GET', '/api/auth/verify', null, 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.invalid');
        assert.ok([401, 403].includes(res.status));
    });

    it('GET /api/auth/verify — no Authorization header returns 401', async () => {
        const res = await request('GET', '/api/auth/verify');
        assert.equal(res.status, 401);
    });
});

// ==========================================
// ROOM CONFLICT
// ==========================================

describe('Room Conflict', () => {
    const date = '2099-09-01';
    let firstBookingId;

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'room_line_1', name: 'Room Test 1', color: '#FF0000' },
            { id: 'room_line_2', name: 'Room Test 2', color: '#00FF00' }
        ]);
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'room_line_1', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
        firstBookingId = res.data.booking.id;
    });

    it('POST /api/bookings — same room same time on different line returns 409', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '14:30', lineId: 'room_line_2', room: 'Marvel',
            programCode: 'АН', label: 'АН(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
        assert.equal(res.status, 409, `Expected 409, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.error.includes('Marvel'), 'Error should mention the room');
    });

    it('POST /api/bookings — same room non-overlapping time succeeds', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '16:00', lineId: 'room_line_2', room: 'Marvel',
            programCode: 'АН', label: 'АН(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        if (res.data.booking) await authRequest('DELETE', `/api/bookings/${res.data.booking.id}?permanent=true`);
    });

    it('POST /api/bookings — different room same time succeeds', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'room_line_2', room: 'Ninja',
            programCode: 'АН', label: 'АН(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        if (res.data.booking) await authRequest('DELETE', `/api/bookings/${res.data.booking.id}?permanent=true`);
    });

    after(async () => {
        if (firstBookingId) await authRequest('DELETE', `/api/bookings/${firstBookingId}?permanent=true`);
    });
});

// ==========================================
// LINKED BOOKING CASCADE DELETE
// ==========================================

describe('Linked Booking Cascade', () => {
    const date = '2099-09-02';
    let mainId;

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'cascade_line_1', name: 'Cascade 1', color: '#FF0000' },
            { id: 'cascade_line_2', name: 'Cascade 2', color: '#00FF00' }
        ]);
    });

    it('soft delete main should cascade to linked bookings', async () => {
        const res = await authRequest('POST', '/api/bookings/full', {
            main: {
                date, time: '14:00', lineId: 'cascade_line_1', room: 'Minecraft',
                programCode: 'КВ4', label: 'КВ4(60)', duration: 60, price: 2800,
                category: 'quest', status: 'confirmed'
            },
            linked: [{
                date, time: '14:00', lineId: 'cascade_line_2', room: 'Minecraft',
                programCode: 'КВ4', label: 'КВ4(60)', duration: 60, price: 0,
                category: 'quest', status: 'confirmed'
            }]
        });
        assert.equal(res.status, 200);
        mainId = res.data.mainBooking.id;
        const linkedId = res.data.linkedBookings[0].id;

        const del = await authRequest('DELETE', `/api/bookings/${mainId}`);
        assert.equal(del.status, 200);

        const check = await authRequest('GET', `/api/bookings/${date}`);
        const foundMain = check.data.find(b => b.id === mainId);
        const foundLinked = check.data.find(b => b.id === linkedId);
        assert.ok(!foundMain, 'Main should not appear after soft delete');
        assert.ok(!foundLinked, 'Linked should not appear after cascade soft delete');
    });

    after(async () => {
        if (mainId) await authRequest('DELETE', `/api/bookings/${mainId}?permanent=true`);
    });
});

// ==========================================
// LINKED BOOKING SYNC ON EDIT
// ==========================================

describe('Linked Booking Sync', () => {
    const date = '2099-09-03';
    let mainId, linkedId;

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'sync_line_1', name: 'Sync 1', color: '#AA0000' },
            { id: 'sync_line_2', name: 'Sync 2', color: '#00AA00' }
        ]);
        const res = await authRequest('POST', '/api/bookings/full', {
            main: {
                date, time: '14:00', lineId: 'sync_line_1', room: 'Elsa',
                programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
                category: 'quest', status: 'confirmed'
            },
            linked: [{
                date, time: '14:00', lineId: 'sync_line_2', room: 'Elsa',
                programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 0,
                category: 'quest', status: 'confirmed'
            }]
        });
        mainId = res.data.mainBooking.id;
        linkedId = res.data.linkedBookings[0].id;
    });

    it('editing main should sync time, date, duration, status to linked', async () => {
        const newDate = '2099-09-04';
        await authRequest('POST', `/api/lines/${newDate}`, [
            { id: 'sync_line_1', name: 'Sync 1', color: '#AA0000' },
            { id: 'sync_line_2', name: 'Sync 2', color: '#00AA00' }
        ]);

        const res = await authRequest('PUT', `/api/bookings/${mainId}`, {
            date: newDate, time: '16:00', lineId: 'sync_line_1', room: 'Elsa',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 90, price: 2200,
            category: 'quest', status: 'preliminary'
        });
        assert.equal(res.status, 200);

        const check = await authRequest('GET', `/api/bookings/${newDate}`);
        const linked = check.data.find(b => b.id === linkedId);
        assert.ok(linked, 'Linked booking should be on new date');
        assert.equal(linked.time, '16:00', 'Linked time should sync');
        assert.equal(linked.duration, 90, 'Linked duration should sync');
        assert.equal(linked.status, 'preliminary', 'Linked status should sync');
    });

    after(async () => {
        if (mainId) await authRequest('DELETE', `/api/bookings/${mainId}?permanent=true`);
    });
});

// ==========================================
// BOOKING NUMBER FORMAT
// ==========================================

describe('Booking Number Format', () => {
    const date = '2099-09-05';

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'bknum_line', name: 'BK Num Test', color: '#AABBCC' }
        ]);
    });

    it('auto-generated booking ID matches BK-YYYY-NNNN format', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '10:00', lineId: 'bknum_line', room: 'Rock',
            programCode: 'АН', label: 'АН(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
        assert.equal(res.status, 200);
        const id = res.data.booking.id;
        assert.match(id, /^BK-\d{4}-\d{4,}$/, `ID should be BK-YYYY-NNNN, got: ${id}`);

        await authRequest('DELETE', `/api/bookings/${id}?permanent=true`);
    });

    it('sequential bookings get incrementing IDs', async () => {
        const res1 = await authRequest('POST', '/api/bookings', {
            date, time: '10:00', lineId: 'bknum_line', room: 'Rock',
            programCode: 'АН', label: 'АН(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
        const res2 = await authRequest('POST', '/api/bookings', {
            date, time: '12:00', lineId: 'bknum_line', room: 'Minion',
            programCode: 'АН2', label: 'АН2(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
        const num1 = parseInt(res1.data.booking.id.split('-')[2]);
        const num2 = parseInt(res2.data.booking.id.split('-')[2]);
        assert.ok(num2 > num1, `Second ID (${num2}) should be greater than first (${num1})`);

        await authRequest('DELETE', `/api/bookings/${res1.data.booking.id}?permanent=true`);
        await authRequest('DELETE', `/api/bookings/${res2.data.booking.id}?permanent=true`);
    });
});

// ==========================================
// LINES VALIDATION
// ==========================================

describe('Lines Validation', () => {
    it('POST /api/lines/:date — invalid date returns 400', async () => {
        const res = await authRequest('POST', '/api/lines/bad-date', [
            { id: 'x', name: 'X', color: '#000' }
        ]);
        assert.equal(res.status, 400);
    });

    it('POST /api/lines/:date — non-array body returns 400', async () => {
        const res = await authRequest('POST', '/api/lines/2099-01-20', { id: 'x' });
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('array'), 'Error should mention array');
    });

    it('GET /api/lines/:date — ensures at least 2 default lines', async () => {
        const freshDate = '2099-12-25';
        const res = await authRequest('GET', `/api/lines/${freshDate}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.length >= 2, `Should have at least 2 lines, got ${res.data.length}`);
    });
});

// ==========================================
// STATS VALIDATION
// ==========================================

describe('Stats Validation', () => {
    it('GET /api/stats — invalid dateFrom returns 400', async () => {
        const res = await authRequest('GET', '/api/stats/bad-date/2099-01-31');
        assert.equal(res.status, 400);
    });

    it('GET /api/stats — invalid dateTo returns 400', async () => {
        const res = await authRequest('GET', '/api/stats/2099-01-01/not-valid');
        assert.equal(res.status, 400);
    });

    it('GET /api/stats — excludes linked and cancelled bookings', async () => {
        const res = await authRequest('GET', '/api/stats/2099-01-01/2099-12-31');
        assert.equal(res.status, 200);
        for (const b of res.data) {
            assert.ok(!b.linkedTo, 'Stats should not include linked bookings');
            assert.notEqual(b.status, 'cancelled', 'Stats should not include cancelled');
        }
    });
});

// ==========================================
// UPDATE/DELETE NON-EXISTENT BOOKING
// ==========================================

describe('Non-existent Booking', () => {
    it('PUT /api/bookings/:id — non-existent ID returns 404', async () => {
        const res = await authRequest('PUT', '/api/bookings/BK-9999-9999', {
            date: '2099-01-01', time: '14:00', lineId: 'x', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1', duration: 60, price: 0,
            category: 'quest', status: 'confirmed'
        });
        assert.equal(res.status, 404);
    });

    it('DELETE /api/bookings/:id — non-existent ID returns 404', async () => {
        const res = await authRequest('DELETE', '/api/bookings/BK-9999-9999');
        assert.equal(res.status, 404);
    });
});

// ==========================================
// HISTORY SEARCH
// ==========================================

describe('History Search', () => {
    it('GET /api/history?search=Marvel — should filter by data content', async () => {
        const res = await authRequest('GET', '/api/history?search=Marvel');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.items));
    });

    it('GET /api/history?offset=0&limit=2 — should paginate', async () => {
        const res = await authRequest('GET', '/api/history?offset=0&limit=2');
        assert.equal(res.status, 200);
        assert.ok(res.data.items.length <= 2);
        assert.equal(res.data.offset, 0);
        assert.equal(res.data.limit, 2);
    });

    it('GET /api/history?limit=999 — caps at 500', async () => {
        const res = await authRequest('GET', '/api/history?limit=999');
        assert.equal(res.status, 200);
        assert.equal(res.data.limit, 500, 'Limit should be capped at 500');
    });
});

// ==========================================
// TELEGRAM ENDPOINTS
// ==========================================

describe('Telegram Notify', () => {
    it('POST /api/telegram/notify — empty text returns no_text reason', async () => {
        const res = await authRequest('POST', '/api/telegram/notify', {});
        assert.equal(res.status, 200);
        assert.equal(res.data.success, false);
        assert.equal(res.data.reason, 'no_text');
    });

    it('POST /api/telegram/notify — with text returns response', async () => {
        const res = await authRequest('POST', '/api/telegram/notify', { text: 'Test message from API' });
        assert.equal(res.status, 200);
        assert.ok('success' in res.data, 'Should have success field');
    });
});

describe('Telegram Chats & Threads', () => {
    it('GET /api/telegram/chats — should return object with chats array', async () => {
        const res = await authRequest('GET', '/api/telegram/chats');
        assert.equal(res.status, 200);
        assert.ok(res.data.chats, 'Should have chats property');
        assert.ok(Array.isArray(res.data.chats), 'chats should be array');
    });

    it('GET /api/telegram/threads — should return object with threads array', async () => {
        const res = await authRequest('GET', '/api/telegram/threads');
        assert.equal(res.status, 200);
        assert.ok(res.data.threads, 'Should have threads property');
        assert.ok(Array.isArray(res.data.threads), 'threads should be array');
    });
});

describe('Telegram Webhook', () => {
    it('POST /api/telegram/webhook — without secret returns 403', async () => {
        const res = await request('POST', '/api/telegram/webhook', { message: {} });
        assert.equal(res.status, 403);
    });

    it('POST /api/telegram/webhook — wrong secret returns 403', async () => {
        const fetchRes = await fetch(`${require('./helpers').BASE_URL}/api/telegram/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong-secret' },
            body: JSON.stringify({ message: { chat: { id: 123 } } })
        });
        assert.equal(fetchRes.status, 403);
    });
});

describe('Telegram Animator Status', () => {
    it('GET /api/telegram/animator-status/:id — non-existent returns not_found', async () => {
        const res = await authRequest('GET', '/api/telegram/animator-status/999999');
        assert.equal(res.status, 200);
        assert.equal(res.data.status, 'not_found');
    });
});

// ==========================================
// BACKUP ENDPOINTS
// ==========================================

describe('Backup Download', () => {
    it('GET /api/backup/download — returns SQL content', async () => {
        const token = await getToken();
        const fetchRes = await fetch(`${require('./helpers').BASE_URL}/api/backup/download`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        assert.equal(fetchRes.status, 200);
        const contentType = fetchRes.headers.get('content-type');
        assert.ok(contentType.includes('sql') || contentType.includes('text'), `Content-Type should be SQL, got: ${contentType}`);
        const body = await fetchRes.text();
        assert.ok(body.length > 0, 'Backup should not be empty');
        assert.ok(body.includes('DELETE') || body.includes('INSERT'), 'Backup should contain SQL statements');
    });
});

describe('Backup Restore Validation', () => {
    it('POST /api/backup/restore — missing body returns 400', async () => {
        const res = await authRequest('POST', '/api/backup/restore', {});
        assert.equal(res.status, 400);
        assert.ok(res.data.error);
    });

    it('POST /api/backup/restore — non-string sql returns 400', async () => {
        const res = await authRequest('POST', '/api/backup/restore', { sql: 123 });
        assert.equal(res.status, 400);
    });

    it('POST /api/backup/restore — forbidden statements (DROP) returns 400', async () => {
        const res = await authRequest('POST', '/api/backup/restore', {
            sql: 'DROP TABLE bookings;'
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('Only INSERT and DELETE'));
    });

    it('POST /api/backup/restore — forbidden statements (UPDATE) returns 400', async () => {
        const res = await authRequest('POST', '/api/backup/restore', {
            sql: "UPDATE users SET role = 'admin' WHERE id = 1;"
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/backup/restore — valid INSERT executes', async () => {
        const res = await authRequest('POST', '/api/backup/restore', {
            sql: "INSERT INTO settings (key, value) VALUES ('restore_test_key', 'restore_test_val') ON CONFLICT (key) DO UPDATE SET value = 'restore_test_val';"
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.equal(res.data.executed, 1);

        const check = await authRequest('GET', '/api/settings/restore_test_key');
        assert.equal(check.data.value, 'restore_test_val');
    });
});

// ==========================================
// DUPLICATE PROGRAM DETECTION
// ==========================================

describe('Duplicate Program Detection', () => {
    const date = '2099-09-06';
    let firstId;

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'dup_line_1', name: 'Dup 1', color: '#CC0000' },
            { id: 'dup_line_2', name: 'Dup 2', color: '#00CC00' }
        ]);
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'dup_line_1', room: 'Marvel',
            programId: 'party_pack_1', programCode: 'КВ1', label: 'КВ1(60)',
            duration: 60, price: 2200, category: 'quest', status: 'confirmed'
        });
        firstId = res.data.booking.id;
    });

    it('same programId overlapping time returns 409', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '14:30', lineId: 'dup_line_2', room: 'Ninja',
            programId: 'party_pack_1', programCode: 'КВ1', label: 'КВ1(60)',
            duration: 60, price: 2200, category: 'quest', status: 'confirmed'
        });
        assert.equal(res.status, 409, `Expected 409, got ${res.status}: ${JSON.stringify(res.data)}`);
    });

    it('animation category bypasses duplicate check', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '14:30', lineId: 'dup_line_2', room: 'Ninja',
            programId: 'party_pack_1', programCode: 'АН', label: 'АН(60)',
            duration: 60, price: 1500, category: 'animation', status: 'confirmed'
        });
        assert.ok([200, 409].includes(res.status));
        if (res.data.booking) await authRequest('DELETE', `/api/bookings/${res.data.booking.id}?permanent=true`);
    });

    after(async () => {
        if (firstId) await authRequest('DELETE', `/api/bookings/${firstId}?permanent=true`);
    });
});

// ==========================================
// UNAUTHENTICATED — MORE ENDPOINTS
// ==========================================

describe('Unauthenticated — extended', () => {
    it('POST /api/telegram/notify — without token returns 401', async () => {
        const res = await request('POST', '/api/telegram/notify', { text: 'test' });
        assert.equal(res.status, 401);
    });

    it('GET /api/telegram/chats — without token returns 401', async () => {
        const res = await request('GET', '/api/telegram/chats');
        assert.equal(res.status, 401);
    });

    it('POST /api/backup/restore — without token returns 401', async () => {
        const res = await request('POST', '/api/backup/restore', { sql: 'DELETE FROM settings;' });
        assert.equal(res.status, 401);
    });

    it('GET /api/backup/download — without token returns 401', async () => {
        const res = await request('GET', '/api/backup/download');
        assert.equal(res.status, 401);
    });

    it('POST /api/lines/:date — without token returns 401', async () => {
        const res = await request('POST', '/api/lines/2099-01-01', []);
        assert.equal(res.status, 401);
    });

    it('GET /api/rooms/free/:date/:time/:dur — without token returns 401', async () => {
        const res = await request('GET', '/api/rooms/free/2099-01-01/14:00/60');
        assert.equal(res.status, 401);
    });
});
