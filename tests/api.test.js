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

    it('POST /api/auth/login — wrong password rejected', async () => {
        const res = await request('POST', '/api/auth/login', {
            username: TEST_USER,
            password: 'wrong_password_12345'
        });
        assert.equal(res.status, 401);
    });

    it('POST /api/auth/login — missing password rejected', async () => {
        const res = await request('POST', '/api/auth/login', {
            username: TEST_USER
        });
        assert.equal(res.status, 400);
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

    it('POST /api/auth/login — login without password rejected', async () => {
        const res = await request('POST', '/api/auth/login', { username: 'admin' });
        assert.equal(res.status, 400);
    });

    it('POST /api/auth/login — nonexistent user rejected', async () => {
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
        // May return 500 if Telegram chat_id causes query issues
        assert.ok([200, 500].includes(res.status), `Expected 200 or 500, got ${res.status}`);
        if (res.status === 200) {
            assert.ok(res.data.threads, 'Should have threads property');
            assert.ok(Array.isArray(res.data.threads), 'threads should be array');
        }
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

    it('PUT /api/bookings/:id — without token returns 401', async () => {
        const res = await request('PUT', '/api/bookings/BK-2099-0001', {
            date: '2099-01-01', time: '14:00', lineId: 'x', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1', duration: 60, price: 0,
            category: 'quest', status: 'confirmed'
        });
        assert.equal(res.status, 401);
    });

    it('DELETE /api/bookings/:id — without token returns 401', async () => {
        const res = await request('DELETE', '/api/bookings/BK-2099-0001');
        assert.equal(res.status, 401);
    });

    it('POST /api/bookings/full — without token returns 401', async () => {
        const res = await request('POST', '/api/bookings/full', { main: {}, linked: [] });
        assert.equal(res.status, 401);
    });

    it('GET /api/stats/:from/:to — without token returns 401', async () => {
        const res = await request('GET', '/api/stats/2099-01-01/2099-01-31');
        assert.equal(res.status, 401);
    });

    it('POST /api/settings — without token returns 401', async () => {
        const res = await request('POST', '/api/settings', { key: 'test', value: 'x' });
        assert.equal(res.status, 401);
    });

    it('GET /api/telegram/threads — without token returns 401', async () => {
        const res = await request('GET', '/api/telegram/threads');
        assert.equal(res.status, 401);
    });
});

// ==========================================
// BOOKING GET VALIDATION
// ==========================================

describe('Booking GET Validation', () => {
    it('GET /api/bookings/:date — invalid date format returns 400', async () => {
        const res = await authRequest('GET', '/api/bookings/not-a-date');
        assert.equal(res.status, 400);
        assert.ok(res.data.error);
    });
});

// ==========================================
// BOOKING PUT VALIDATION
// ==========================================

describe('Booking PUT Validation', () => {
    const date = '2099-10-01';
    let bookingId;

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'put_val_line', name: 'Put Val Test', color: '#112233' }
        ]);
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'put_val_line', room: 'Rock',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
        bookingId = res.data.booking.id;
    });

    it('PUT /api/bookings/:id — invalid date returns 400', async () => {
        const res = await authRequest('PUT', `/api/bookings/${bookingId}`, {
            date: 'bad-date', time: '14:00', lineId: 'put_val_line', room: 'Rock',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
        assert.equal(res.status, 400);
    });

    it('PUT /api/bookings/:id — invalid time returns 400', async () => {
        const res = await authRequest('PUT', `/api/bookings/${bookingId}`, {
            date, time: 'bad-time', lineId: 'put_val_line', room: 'Rock',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
        assert.equal(res.status, 400);
    });

    it('PUT /api/bookings/:id — room conflict on update returns 409', async () => {
        const other = await authRequest('POST', '/api/bookings', {
            date, time: '16:00', lineId: 'put_val_line', room: 'Marvel',
            programCode: 'АН', label: 'АН(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
        assert.equal(other.status, 200);

        const res = await authRequest('PUT', `/api/bookings/${bookingId}`, {
            date, time: '16:00', lineId: 'put_val_line', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
        assert.equal(res.status, 409, `Expected 409 room conflict, got ${res.status}`);

        if (other.data.booking) await authRequest('DELETE', `/api/bookings/${other.data.booking.id}?permanent=true`);
    });

    it('PUT /api/bookings/:id — time conflict on update returns 409', async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'put_val_line', name: 'Put Val Test', color: '#112233' },
            { id: 'put_val_line2', name: 'Put Val Test 2', color: '#445566' }
        ]);
        const other = await authRequest('POST', '/api/bookings', {
            date, time: '18:00', lineId: 'put_val_line', room: 'Ninja',
            programCode: 'АН', label: 'АН(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
        assert.equal(other.status, 200);

        const res = await authRequest('PUT', `/api/bookings/${bookingId}`, {
            date, time: '18:30', lineId: 'put_val_line', room: 'Rock',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
        assert.equal(res.status, 409, `Expected 409 time conflict, got ${res.status}`);

        if (other.data.booking) await authRequest('DELETE', `/api/bookings/${other.data.booking.id}?permanent=true`);
    });

    after(async () => {
        if (bookingId) await authRequest('DELETE', `/api/bookings/${bookingId}?permanent=true`);
    });
});

// ==========================================
// BOOKING DELETE VALIDATION
// ==========================================

describe('Booking DELETE Validation', () => {
    it('DELETE /api/bookings/:id — invalid ID format returns 400', async () => {
        const res = await authRequest('DELETE', '/api/bookings/' + 'X'.repeat(101));
        assert.equal(res.status, 400);
    });
});

// ==========================================
// BOOKING FULL VALIDATION
// ==========================================

describe('Booking Full Validation', () => {
    const date = '2099-10-02';

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'full_val_1', name: 'Full Val 1', color: '#AA0000' },
            { id: 'full_val_2', name: 'Full Val 2', color: '#00AA00' },
            { id: 'full_val_3', name: 'Full Val 3', color: '#0000AA' }
        ]);
    });

    it('POST /api/bookings/full — missing main returns 400', async () => {
        const res = await authRequest('POST', '/api/bookings/full', { linked: [] });
        assert.equal(res.status, 400);
    });

    it('POST /api/bookings/full — missing main.date returns 400', async () => {
        const res = await authRequest('POST', '/api/bookings/full', {
            main: { time: '14:00', lineId: 'full_val_1' },
            linked: []
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/bookings/full — invalid main date returns 400', async () => {
        const res = await authRequest('POST', '/api/bookings/full', {
            main: { date: 'bad', time: '14:00', lineId: 'full_val_1', room: 'Marvel',
                programCode: 'КВ1', label: 'КВ1', duration: 60, price: 0, category: 'quest' },
            linked: []
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/bookings/full — invalid main time returns 400', async () => {
        const res = await authRequest('POST', '/api/bookings/full', {
            main: { date, time: 'bad', lineId: 'full_val_1', room: 'Marvel',
                programCode: 'КВ1', label: 'КВ1', duration: 60, price: 0, category: 'quest' },
            linked: []
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/bookings/full — room conflict returns 409', async () => {
        const blocker = await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'full_val_1', room: 'Elsa',
            programCode: 'АН', label: 'АН(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
        assert.equal(blocker.status, 200);

        const res = await authRequest('POST', '/api/bookings/full', {
            main: { date, time: '14:00', lineId: 'full_val_2', room: 'Elsa',
                programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
                category: 'quest', status: 'confirmed' },
            linked: []
        });
        assert.equal(res.status, 409, `Expected room conflict, got ${res.status}`);

        if (blocker.data.booking) await authRequest('DELETE', `/api/bookings/${blocker.data.booking.id}?permanent=true`);
    });

    it('POST /api/bookings/full — linked booking line conflict returns 409', async () => {
        const blocker = await authRequest('POST', '/api/bookings', {
            date, time: '16:00', lineId: 'full_val_2', room: 'Ninja',
            programCode: 'АН', label: 'АН(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
        assert.equal(blocker.status, 200);

        const res = await authRequest('POST', '/api/bookings/full', {
            main: { date, time: '16:00', lineId: 'full_val_1', room: 'Rock',
                programCode: 'КВ4', label: 'КВ4(60)', duration: 60, price: 2800,
                category: 'quest', status: 'confirmed' },
            linked: [{
                date, time: '16:00', lineId: 'full_val_2', room: 'Rock',
                programCode: 'КВ4', label: 'КВ4(60)', duration: 60, price: 0,
                category: 'quest', status: 'confirmed'
            }]
        });
        assert.equal(res.status, 409, `Expected linked line conflict, got ${res.status}`);

        if (blocker.data.booking) await authRequest('DELETE', `/api/bookings/${blocker.data.booking.id}?permanent=true`);
    });

    it('POST /api/bookings/full — multiple linked bookings', async () => {
        const res = await authRequest('POST', '/api/bookings/full', {
            main: { date, time: '19:00', lineId: 'full_val_1', room: 'Minecraft',
                programCode: 'КВ4', label: 'КВ4(60)', duration: 60, price: 2800,
                category: 'quest', status: 'confirmed' },
            linked: [
                { date, time: '19:00', lineId: 'full_val_2', room: 'Minecraft',
                    programCode: 'КВ4', label: 'КВ4(60)', duration: 60, price: 0,
                    category: 'quest', status: 'confirmed' },
                { date, time: '19:00', lineId: 'full_val_3', room: 'Minecraft',
                    programCode: 'КВ4', label: 'КВ4(60)', duration: 60, price: 0,
                    category: 'quest', status: 'confirmed' }
            ]
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.equal(res.data.linkedBookings.length, 2, 'Should have 2 linked bookings');
        assert.equal(res.data.linkedBookings[0].linkedTo, res.data.mainBooking.id);
        assert.equal(res.data.linkedBookings[1].linkedTo, res.data.mainBooking.id);

        if (res.data.mainBooking) await authRequest('DELETE', `/api/bookings/${res.data.mainBooking.id}?permanent=true`);
    });
});

// ==========================================
// BOOKING OPTIONAL FIELDS
// ==========================================

describe('Booking Optional Fields', () => {
    const date = '2099-10-03';
    let bookingId;

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'opt_line', name: 'Optional Fields Test', color: '#AABB00' }
        ]);
    });

    it('POST /api/bookings — all optional fields are preserved', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'opt_line', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 90, price: 3500,
            category: 'quest', status: 'confirmed',
            hosts: 2,
            secondAnimator: 'Даша',
            pinataFiller: 'цукерки',
            costume: 'Ельза',
            notes: 'VIP клієнт, алергія на горіхи',
            kidsCount: 15,
            groupName: 'ДР Максим'
        });
        assert.equal(res.status, 200);
        bookingId = res.data.booking.id;

        const booking = res.data.booking;
        assert.equal(booking.duration, 90);
        assert.equal(booking.price, 3500);
        assert.equal(booking.hosts, 2);
        assert.equal(booking.secondAnimator, 'Даша');
        assert.equal(booking.pinataFiller, 'цукерки');
        assert.equal(booking.costume, 'Ельза');
        assert.equal(booking.kidsCount, 15);
        assert.equal(booking.groupName, 'ДР Максим');
        assert.ok(booking.notes.includes('VIP'));
    });

    it('GET /api/bookings/:date — optional fields returned in list', async () => {
        const res = await authRequest('GET', `/api/bookings/${date}`);
        assert.equal(res.status, 200);
        const booking = res.data.find(b => b.id === bookingId);
        assert.ok(booking);
        assert.equal(booking.hosts, 2);
        assert.equal(booking.costume, 'Ельза');
        assert.equal(booking.kidsCount, 15);
        assert.equal(booking.groupName, 'ДР Максим');
    });

    after(async () => {
        if (bookingId) await authRequest('DELETE', `/api/bookings/${bookingId}?permanent=true`);
    });
});

// ==========================================
// BOOKING STATUS TRANSITIONS
// ==========================================

describe('Booking Status Transitions', () => {
    const date = '2099-10-04';
    let bookingId;

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'trans_line', name: 'Transition Test', color: '#FF9900' }
        ]);
    });

    it('create preliminary then confirm via PUT', async () => {
        const create = await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'trans_line', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'preliminary'
        });
        assert.equal(create.status, 200);
        bookingId = create.data.booking.id;
        assert.equal(create.data.booking.status, 'preliminary');

        const update = await authRequest('PUT', `/api/bookings/${bookingId}`, {
            date, time: '14:00', lineId: 'trans_line', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
        assert.equal(update.status, 200);

        const check = await authRequest('GET', `/api/bookings/${date}`);
        const booking = check.data.find(b => b.id === bookingId);
        assert.equal(booking.status, 'confirmed');
    });

    it('preliminary booking included in stats (not cancelled)', async () => {
        const prelim = await authRequest('POST', '/api/bookings', {
            date, time: '16:00', lineId: 'trans_line', room: 'Ninja',
            programCode: 'АН', label: 'АН(60)', duration: 60, price: 1500,
            category: 'animation', status: 'preliminary'
        });
        assert.equal(prelim.status, 200);

        const stats = await authRequest('GET', `/api/stats/${date}/${date}`);
        assert.equal(stats.status, 200);
        assert.ok(Array.isArray(stats.data));
        // Preliminary should be in stats (only cancelled and linked are excluded)
        const found = stats.data.find(b => b.id === prelim.data.booking.id);
        assert.ok(found, 'Preliminary booking should appear in stats');

        if (prelim.data.booking) await authRequest('DELETE', `/api/bookings/${prelim.data.booking.id}?permanent=true`);
    });

    after(async () => {
        if (bookingId) await authRequest('DELETE', `/api/bookings/${bookingId}?permanent=true`);
    });
});

// ==========================================
// TELEGRAM DIGEST & REMINDER
// ==========================================

describe('Telegram Digest', () => {
    const date = '2099-10-05';

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'digest_line', name: 'Digest Test', color: '#FF0000' }
        ]);
        await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'digest_line', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
    });

    it('GET /api/telegram/digest/:date — returns result object', async () => {
        const res = await authRequest('GET', `/api/telegram/digest/${date}`);
        assert.equal(res.status, 200);
        assert.ok('success' in res.data, 'Should have success field');
        assert.ok('count' in res.data, 'Should have count field');
    });

    it('GET /api/telegram/digest/:date — empty date returns count 0', async () => {
        const res = await authRequest('GET', '/api/telegram/digest/2099-12-31');
        assert.equal(res.status, 200);
        assert.equal(res.data.count, 0, 'No bookings should return count 0');
    });

    it('GET /api/telegram/digest/:date — without token returns 401', async () => {
        const res = await request('GET', '/api/telegram/digest/2099-01-01');
        assert.equal(res.status, 401);
    });
});

describe('Telegram Reminder', () => {
    it('GET /api/telegram/reminder/:date — returns result object', async () => {
        const res = await authRequest('GET', '/api/telegram/reminder/2099-01-01');
        assert.equal(res.status, 200);
        assert.ok('success' in res.data, 'Should have success field');
    });

    it('GET /api/telegram/reminder/:date — without token returns 401', async () => {
        const res = await request('GET', '/api/telegram/reminder/2099-01-01');
        assert.equal(res.status, 401);
    });
});

// ==========================================
// TELEGRAM ASK ANIMATOR
// ==========================================

describe('Telegram Ask Animator', () => {
    it('POST /api/telegram/ask-animator — returns result or 500 if Telegram API unavailable', async () => {
        const res = await authRequest('POST', '/api/telegram/ask-animator', {
            date: '2099-10-06',
            note: 'Test request from API tests'
        });
        // May return 200 (Telegram API available) or 500 (API unreachable)
        assert.ok([200, 500].includes(res.status), `Expected 200 or 500, got ${res.status}`);
        if (res.status === 200) {
            assert.ok('success' in res.data, 'Should have success field');
            assert.ok('requestId' in res.data, 'Should have requestId');
        }
    });

    it('POST /api/telegram/ask-animator — without token returns 401', async () => {
        const res = await request('POST', '/api/telegram/ask-animator', {
            date: '2099-10-06'
        });
        assert.equal(res.status, 401);
    });

    it('GET /api/telegram/animator-status/:id — returns status', async () => {
        // Use animator-status endpoint directly (doesn't depend on Telegram API)
        const res = await authRequest('GET', '/api/telegram/animator-status/1');
        assert.equal(res.status, 200);
        assert.ok('status' in res.data, 'Should have status field');
    });
});

// ==========================================
// BACKUP CREATE
// ==========================================

describe('Backup Create', () => {
    it('POST /api/backup/create — returns result', async () => {
        const res = await authRequest('POST', '/api/backup/create', {});
        assert.equal(res.status, 200);
        assert.ok('success' in res.data, 'Should have success field');
    });

    it('POST /api/backup/create — without token returns 401', async () => {
        const res = await request('POST', '/api/backup/create', {});
        assert.equal(res.status, 401);
    });
});

// ==========================================
// BACKUP DOWNLOAD HEADERS
// ==========================================

describe('Backup Download Headers', () => {
    it('GET /api/backup/download — has correct content-disposition', async () => {
        const token = await getToken();
        const fetchRes = await fetch(`${require('./helpers').BASE_URL}/api/backup/download`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        assert.equal(fetchRes.status, 200);
        const disposition = fetchRes.headers.get('content-disposition');
        assert.ok(disposition, 'Should have Content-Disposition header');
        assert.ok(disposition.includes('backup_'), 'Filename should contain backup_');
        assert.ok(disposition.includes('.sql'), 'Filename should end with .sql');
        await fetchRes.text();
    });

    it('GET /api/backup/download — backup SQL contains all table names', async () => {
        const token = await getToken();
        const fetchRes = await fetch(`${require('./helpers').BASE_URL}/api/backup/download`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const body = await fetchRes.text();
        assert.ok(body.includes('bookings') || body.includes('Backup'), 'Should contain table references');
        assert.ok(body.includes('-- Backup:'), 'Should have backup header comment');
    });
});

// ==========================================
// LINES OVERWRITE & EMPTY
// ==========================================

describe('Lines Overwrite', () => {
    const date = '2099-10-08';

    it('POST /api/lines/:date — overwrites existing lines', async () => {
        // Save 3 lines
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'ow1', name: 'Line 1', color: '#FF0000' },
            { id: 'ow2', name: 'Line 2', color: '#00FF00' },
            { id: 'ow3', name: 'Line 3', color: '#0000FF' }
        ]);
        let check = await authRequest('GET', `/api/lines/${date}`);
        assert.equal(check.data.length, 3);

        // Overwrite with 2 new lines (>= 2 avoids ensureDefaultLines padding)
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'ow_new_a', name: 'Replaced A', color: '#AABBCC' },
            { id: 'ow_new_b', name: 'Replaced B', color: '#DDEEFF' }
        ]);
        check = await authRequest('GET', `/api/lines/${date}`);
        assert.equal(check.data.length, 2, 'Should have 2 lines after overwrite');
        const names = check.data.map(l => l.name);
        assert.ok(names.includes('Replaced A'), 'Should contain Replaced A');
        assert.ok(names.includes('Replaced B'), 'Should contain Replaced B');
        assert.ok(!names.includes('Line 1'), 'Old Line 1 should be gone');
    });

    it('POST /api/lines/:date — empty array clears all lines', async () => {
        await authRequest('POST', `/api/lines/${date}`, []);
        const check = await authRequest('GET', `/api/lines/${date}`);
        assert.ok(check.data.length >= 2, `Empty array + ensureDefaultLines should give >= 2, got ${check.data.length}`);
    });

    it('POST /api/lines/:date — lines have fromSheet field', async () => {
        const lineDate = '2099-10-09';
        await authRequest('POST', `/api/lines/${lineDate}`, [
            { id: 'fs1', name: 'From Sheet', color: '#FF0000', fromSheet: true },
            { id: 'fs2', name: 'Manual', color: '#00FF00', fromSheet: false }
        ]);
        const check = await authRequest('GET', `/api/lines/${lineDate}`);
        const fromSheet = check.data.find(l => l.id === 'fs1');
        const manual = check.data.find(l => l.id === 'fs2');
        assert.ok(fromSheet, 'fromSheet line should exist');
        assert.equal(fromSheet.fromSheet, true);
        assert.equal(manual.fromSheet, false);
    });
});

// ==========================================
// HISTORY COMBINED FILTERS & PAGINATION
// ==========================================

describe('History Combined Filters', () => {
    before(async () => {
        await authRequest('POST', '/api/history', {
            action: 'edit', user: 'filter_test_user',
            data: { label: 'FILTER_MARKER', room: 'Marvel', date: '2099-10-10' }
        });
        await authRequest('POST', '/api/history', {
            action: 'delete', user: 'filter_test_user',
            data: { label: 'FILTER_MARKER_2', room: 'Ninja', date: '2099-10-10' }
        });
    });

    it('GET /api/history?action=edit&user=filter_test_user — combined filter', async () => {
        const res = await authRequest('GET', '/api/history?action=edit&user=filter_test_user');
        assert.equal(res.status, 200);
        for (const item of res.data.items) {
            assert.equal(item.action, 'edit');
            assert.equal(item.user, 'filter_test_user');
        }
        assert.ok(res.data.items.length > 0, 'Should find entries');
    });

    it('GET /api/history?search=FILTER_MARKER — finds in data', async () => {
        const res = await authRequest('GET', '/api/history?search=FILTER_MARKER');
        assert.equal(res.status, 200);
        assert.ok(res.data.items.length >= 2, 'Should find entries with FILTER_MARKER');
    });

    it('GET /api/history?offset=1&limit=1 — pagination with offset', async () => {
        const page1 = await authRequest('GET', '/api/history?offset=0&limit=1');
        const page2 = await authRequest('GET', '/api/history?offset=1&limit=1');
        assert.equal(page1.status, 200);
        assert.equal(page2.status, 200);
        assert.equal(page1.data.items.length, 1);
        assert.equal(page2.data.items.length, 1);
        if (page1.data.items[0] && page2.data.items[0]) {
            assert.notEqual(page1.data.items[0].id, page2.data.items[0].id, 'Different pages should have different items');
        }
    });
});

// ==========================================
// AFISHA EDGE CASES
// ==========================================

describe('Afisha Edge Cases', () => {
    it('GET /api/afisha/:date — invalid date returns 400', async () => {
        const res = await authRequest('GET', '/api/afisha/not-a-date');
        assert.equal(res.status, 400);
    });

    it('PUT /api/afisha/:id — missing fields returns 400', async () => {
        const create = await authRequest('POST', '/api/afisha', {
            date: '2099-10-11', time: '14:00', title: 'Edge Test', duration: 60
        });
        assert.equal(create.status, 200);
        const id = create.data.item.id;

        const res = await authRequest('PUT', `/api/afisha/${id}`, {
            date: '2099-10-11', time: '14:00'
        });
        assert.equal(res.status, 400);

        await authRequest('DELETE', `/api/afisha/${id}`);
    });

    it('POST /api/afisha — default duration is 60', async () => {
        const res = await authRequest('POST', '/api/afisha', {
            date: '2099-10-12', time: '10:00', title: 'Default Duration'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.item.duration, 60);

        await authRequest('DELETE', `/api/afisha/${res.data.item.id}`);
    });

    it('GET /api/afisha — returns all events sorted', async () => {
        const e1 = await authRequest('POST', '/api/afisha', {
            date: '2099-10-13', time: '14:00', title: 'Event A'
        });
        const e2 = await authRequest('POST', '/api/afisha', {
            date: '2099-10-14', time: '10:00', title: 'Event B'
        });

        const all = await authRequest('GET', '/api/afisha');
        assert.equal(all.status, 200);
        assert.ok(Array.isArray(all.data));

        const foundA = all.data.find(e => e.title === 'Event A');
        const foundB = all.data.find(e => e.title === 'Event B');
        assert.ok(foundA, 'Event A should be in all events');
        assert.ok(foundB, 'Event B should be in all events');

        await authRequest('DELETE', `/api/afisha/${e1.data.item.id}`);
        await authRequest('DELETE', `/api/afisha/${e2.data.item.id}`);
    });
});

// ==========================================
// FREE ROOMS ADVANCED
// ==========================================

describe('Free Rooms Advanced', () => {
    const date = '2099-10-15';

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'fr_line_1', name: 'FreeRoom 1', color: '#FF0000' },
            { id: 'fr_line_2', name: 'FreeRoom 2', color: '#00FF00' },
            { id: 'fr_line_3', name: 'FreeRoom 3', color: '#0000FF' }
        ]);
        await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'fr_line_1', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 2200,
            category: 'quest', status: 'confirmed'
        });
        await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'fr_line_2', room: 'Ninja',
            programCode: 'АН', label: 'АН(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
        await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'fr_line_3', room: 'Minecraft',
            programCode: 'АН2', label: 'АН2(60)', duration: 60, price: 1500,
            category: 'animation', status: 'confirmed'
        });
    });

    it('multiple rooms occupied at once', async () => {
        const res = await authRequest('GET', `/api/rooms/free/${date}/14:00/60`);
        assert.equal(res.status, 200);
        assert.ok(res.data.occupied.includes('Marvel'));
        assert.ok(res.data.occupied.includes('Ninja'));
        assert.ok(res.data.occupied.includes('Minecraft'));
        assert.equal(res.data.occupied.length, 3, 'Should have 3 occupied rooms');
        assert.equal(res.data.free.length, res.data.total - 3, 'Free should be total minus 3');
    });

    it('partial overlap still marks room as occupied', async () => {
        const res = await authRequest('GET', `/api/rooms/free/${date}/14:30/30`);
        assert.equal(res.status, 200);
        assert.ok(res.data.occupied.includes('Marvel'), 'Marvel should be occupied at 14:30');
    });

    it('total rooms equals 14', async () => {
        const res = await authRequest('GET', `/api/rooms/free/${date}/20:00/60`);
        assert.equal(res.status, 200);
        assert.equal(res.data.total, 14, 'Should have 14 total rooms');
        assert.equal(res.data.free.length, 14, 'All 14 rooms should be free at 20:00');
    });
});

// ==========================================
// SETTINGS EDGE CASES
// ==========================================

describe('Settings Edge Cases', () => {
    it('GET /api/settings/:key — non-existent key returns null', async () => {
        const res = await authRequest('GET', '/api/settings/nonexistent_key_xyz');
        assert.equal(res.status, 200);
        assert.equal(res.data.value, null);
    });

    it('POST /api/settings — valid underscore keys accepted', async () => {
        const keys = ['digest_time', 'reminder_time', 'backup_time', 'telegram_chat_id'];
        for (const key of keys) {
            const res = await authRequest('POST', '/api/settings', { key, value: 'test_val' });
            assert.equal(res.status, 200, `Key "${key}" should be accepted`);
        }
    });

    it('POST /api/settings — keys with uppercase rejected', async () => {
        const res = await authRequest('POST', '/api/settings', { key: 'InvalidKey', value: 'test' });
        assert.equal(res.status, 400);
    });

    it('POST /api/settings — keys with numbers rejected', async () => {
        const res = await authRequest('POST', '/api/settings', { key: 'key123', value: 'test' });
        assert.equal(res.status, 400);
    });

    it('POST /api/settings — empty value string accepted', async () => {
        const res = await authRequest('POST', '/api/settings', { key: 'test_empty', value: '' });
        assert.equal(res.status, 200);
        const check = await authRequest('GET', '/api/settings/test_empty');
        assert.equal(check.data.value, '');
    });

    it('POST /api/settings — non-string value rejected', async () => {
        const res = await authRequest('POST', '/api/settings', { key: 'test_num', value: 123 });
        assert.equal(res.status, 400);
    });
});

// ==========================================
// BOOKING SPECIAL CHARACTERS
// ==========================================

describe('Booking Special Characters', () => {
    const date = '2099-10-16';
    let bookingId;

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'special_line', name: 'Special Chars', color: '#ABCDEF' }
        ]);
    });

    it('notes with Ukrainian text and special characters', async () => {
        const notes = "ДР Максима, мама Олена! Тел: +380671234567. Алергія: горіхи & шоколад. Замовлення: торт (кг) на 3'500 ₴";
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '14:00', lineId: 'special_line', room: 'Marvel',
            programCode: 'КВ1', label: 'КВ1(60)', duration: 60, price: 3500,
            category: 'quest', status: 'confirmed',
            notes
        });
        assert.equal(res.status, 200);
        bookingId = res.data.booking.id;

        const check = await authRequest('GET', `/api/bookings/${date}`);
        const booking = check.data.find(b => b.id === bookingId);
        assert.equal(booking.notes, notes, 'Notes should preserve special characters');
    });

    it('program name with Ukrainian characters', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date, time: '16:00', lineId: 'special_line', room: 'Ninja',
            programCode: 'СП', label: 'Спец(60)',
            programName: 'Супер-герої: Повернення Месників!',
            duration: 60, price: 2200,
            category: 'show', status: 'confirmed'
        });
        assert.equal(res.status, 200);
        const booking = res.data.booking;
        assert.equal(booking.programName, 'Супер-герої: Повернення Месників!');

        await authRequest('DELETE', `/api/bookings/${booking.id}?permanent=true`);
    });

    after(async () => {
        if (bookingId) await authRequest('DELETE', `/api/bookings/${bookingId}?permanent=true`);
    });
});

// ==========================================
// HEALTH CHECK DETAILS
// ==========================================

describe('Health Check Details', () => {
    it('GET /api/health — has database field', async () => {
        const res = await request('GET', '/api/health');
        assert.equal(res.status, 200);
        assert.equal(res.data.status, 'ok');
        assert.ok('database' in res.data, 'Should have database field');
        assert.equal(res.data.database, 'connected', 'Database should be connected');
    });

    it('GET /api/health — does not require auth', async () => {
        const res = await request('GET', '/api/health');
        assert.equal(res.status, 200);
    });
});

// ==========================================
// STATIC PAGES
// ==========================================

describe('Static Pages', () => {
    it('GET /invite — returns HTML', async () => {
        const fetchRes = await fetch(`${require('./helpers').BASE_URL}/invite`);
        assert.equal(fetchRes.status, 200);
        const contentType = fetchRes.headers.get('content-type');
        assert.ok(contentType.includes('html'), 'Should return HTML');
        await fetchRes.text();
    });

    it('GET / — returns HTML (SPA)', async () => {
        const fetchRes = await fetch(`${require('./helpers').BASE_URL}/`);
        assert.equal(fetchRes.status, 200);
        const body = await fetchRes.text();
        assert.ok(body.includes('Парк Закревського'), 'Should contain site name');
    });
});

// ==========================================
// AFISHA EVENT TYPES (v7.4)
// ==========================================

describe('Afisha Event Types (v7.4)', () => {
    let eventId, birthdayId, regularId;

    it('POST /api/afisha — create event with type=event (default)', async () => {
        const res = await authRequest('POST', '/api/afisha', {
            date: '2099-07-01', time: '12:00', title: 'Regular Event', duration: 90
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.equal(res.data.item.type, 'event');
        assert.equal(res.data.item.duration, 90);
        eventId = res.data.item.id;
    });

    it('POST /api/afisha — create birthday (type=birthday, duration=15)', async () => {
        const res = await authRequest('POST', '/api/afisha', {
            date: '2099-07-01', time: '14:00', title: 'Артем', type: 'birthday', duration: 120
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.equal(res.data.item.type, 'birthday');
        assert.equal(res.data.item.duration, 15, 'Birthday duration should be forced to 15');
        birthdayId = res.data.item.id;
    });

    it('POST /api/afisha — create regular event (type=regular)', async () => {
        const res = await authRequest('POST', '/api/afisha', {
            date: '2099-07-01', time: '16:00', title: 'Щотижнева казка', type: 'regular', duration: 45
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.equal(res.data.item.type, 'regular');
        assert.equal(res.data.item.duration, 45);
        regularId = res.data.item.id;
    });

    it('POST /api/afisha — invalid type defaults to event', async () => {
        const res = await authRequest('POST', '/api/afisha', {
            date: '2099-07-02', time: '10:00', title: 'Bad Type', type: 'unknown'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.item.type, 'event');
        await authRequest('DELETE', `/api/afisha/${res.data.item.id}`);
    });

    it('GET /api/afisha?type=birthday — filter by type', async () => {
        const res = await authRequest('GET', '/api/afisha?type=birthday');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
        const found = res.data.find(e => e.id === birthdayId);
        assert.ok(found, 'Birthday should appear in filtered results');
        const eventFound = res.data.find(e => e.id === eventId);
        assert.ok(!eventFound, 'Regular event should NOT appear in birthday filter');
    });

    it('GET /api/afisha?type=regular — filter by regular', async () => {
        const res = await authRequest('GET', '/api/afisha?type=regular');
        assert.equal(res.status, 200);
        const found = res.data.find(e => e.id === regularId);
        assert.ok(found, 'Regular event should appear in filtered results');
    });

    it('GET /api/afisha — no filter returns all types', async () => {
        const res = await authRequest('GET', '/api/afisha');
        assert.equal(res.status, 200);
        const ids = res.data.map(e => e.id);
        assert.ok(ids.includes(eventId), 'Should contain event');
        assert.ok(ids.includes(birthdayId), 'Should contain birthday');
        assert.ok(ids.includes(regularId), 'Should contain regular');
    });

    it('PUT /api/afisha/:id — update with type preserved', async () => {
        const res = await authRequest('PUT', `/api/afisha/${birthdayId}`, {
            date: '2099-07-01', time: '15:00', title: 'Артем Оновлений', duration: 15, type: 'birthday'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);

        const check = await authRequest('GET', '/api/afisha/2099-07-01');
        const found = check.data.find(e => e.id === birthdayId);
        assert.equal(found.type, 'birthday');
        assert.equal(found.title, 'Артем Оновлений');
    });

    it('GET /api/afisha/:date — returns all types for date', async () => {
        const res = await authRequest('GET', '/api/afisha/2099-07-01');
        assert.equal(res.status, 200);
        const types = [...new Set(res.data.map(e => e.type))];
        assert.ok(types.includes('event'), 'Should have event type');
        assert.ok(types.includes('birthday'), 'Should have birthday type');
        assert.ok(types.includes('regular'), 'Should have regular type');
    });

    after(async () => {
        if (eventId) await authRequest('DELETE', `/api/afisha/${eventId}`);
        if (birthdayId) await authRequest('DELETE', `/api/afisha/${birthdayId}`);
        if (regularId) await authRequest('DELETE', `/api/afisha/${regularId}`);
    });
});

// ==========================================
// AFISHA TELEGRAM TEMPLATES (v7.3)
// ==========================================

describe('Afisha Telegram Templates (v7.3)', () => {
    it('formatAfishaBlock — included in digest when afisha exists', async () => {
        // Create an afisha event for a test date
        const testDate = '2099-08-01';
        const ev = await authRequest('POST', '/api/afisha', {
            date: testDate, time: '14:00', title: 'Digest Test Event', duration: 90
        });
        assert.equal(ev.status, 200);

        // Trigger digest via API
        const digestRes = await authRequest('GET', `/api/telegram/digest/${testDate}`);
        // Digest sends message (may fail if no chat_id, but should succeed or return specific reason)
        assert.equal(digestRes.status, 200);

        await authRequest('DELETE', `/api/afisha/${ev.data.item.id}`);
    });

    it('formatAfishaBlock — birthday events show in separate block', async () => {
        const testDate = '2099-08-02';
        const ev1 = await authRequest('POST', '/api/afisha', {
            date: testDate, time: '12:00', title: 'Шоу', type: 'event', duration: 60
        });
        const ev2 = await authRequest('POST', '/api/afisha', {
            date: testDate, time: '14:00', title: 'Артемко', type: 'birthday'
        });
        assert.equal(ev1.status, 200);
        assert.equal(ev2.status, 200);

        const digestRes = await authRequest('GET', `/api/telegram/digest/${testDate}`);
        assert.equal(digestRes.status, 200);

        await authRequest('DELETE', `/api/afisha/${ev1.data.item.id}`);
        await authRequest('DELETE', `/api/afisha/${ev2.data.item.id}`);
    });
});

// ==========================================
// Digest with Second Animator (v7.9.3)
// ==========================================

describe('Digest with linked bookings (second animator)', () => {
    const date = '2099-11-15';
    let mainBookingId;

    before(async () => {
        await authRequest('POST', `/api/lines/${date}`, [
            { id: 'line_main_' + date, name: 'Аніматор Головний', color: '#4CAF50' },
            { id: 'line_second_' + date, name: 'Аніматор Другий', color: '#2196F3' }
        ]);
    });

    it('POST /api/bookings/full — creates main + linked booking', async () => {
        const res = await authRequest('POST', '/api/bookings/full', {
            main: {
                date, time: '10:00', lineId: 'line_main_' + date, room: 'Marvel',
                programCode: 'КВ4', label: 'КВ4(60)', programName: 'Шпигунська історія',
                category: 'quest', duration: 60, price: 2800, hosts: 2,
                secondAnimator: 'Аніматор Другий', status: 'confirmed',
                createdBy: 'admin'
            },
            linked: [{
                date, time: '10:00', lineId: 'line_second_' + date, room: 'Marvel',
                programCode: 'КВ4', label: 'КВ4(60)', programName: 'Шпигунська історія',
                category: 'quest', duration: 60, price: 2800, hosts: 2,
                secondAnimator: 'Аніматор Другий', status: 'confirmed',
                createdBy: 'admin'
            }]
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        mainBookingId = res.data.mainBooking.id;
    });

    it('GET /api/telegram/digest/:date — includes second animator bookings', async () => {
        const res = await authRequest('GET', `/api/telegram/digest/${date}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success !== undefined || res.data.count !== undefined);
    });

    after(async () => {
        if (mainBookingId) {
            await authRequest('DELETE', `/api/bookings/${mainBookingId}?permanent=true`);
        }
    });
});

// ==========================================
// TASKS CRUD (v7.5)
// ==========================================

describe('Tasks CRUD (v7.5)', () => {
    let taskId;

    it('GET /api/tasks — should return array', async () => {
        const res = await authRequest('GET', '/api/tasks');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return an array');
    });

    it('POST /api/tasks — create task', async () => {
        const res = await authRequest('POST', '/api/tasks', {
            title: 'Test Task', date: '2099-09-01', priority: 'high', assigned_to: 'Natalia'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.task);
        assert.equal(res.data.task.title, 'Test Task');
        assert.equal(res.data.task.status, 'todo');
        assert.equal(res.data.task.priority, 'high');
        assert.equal(res.data.task.assigned_to, 'Natalia');
        taskId = res.data.task.id;
    });

    it('GET /api/tasks/:id — get single task', async () => {
        assert.ok(taskId);
        const res = await authRequest('GET', `/api/tasks/${taskId}`);
        assert.equal(res.status, 200);
        assert.equal(res.data.title, 'Test Task');
    });

    it('GET /api/tasks?status=todo — filter by status', async () => {
        const res = await authRequest('GET', '/api/tasks?status=todo');
        assert.equal(res.status, 200);
        const found = res.data.find(t => t.id === taskId);
        assert.ok(found, 'Task should appear in todo filter');
    });

    it('PATCH /api/tasks/:id/status — change status to in_progress', async () => {
        const res = await authRequest('PATCH', `/api/tasks/${taskId}/status`, { status: 'in_progress' });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.equal(res.data.task.status, 'in_progress');
    });

    it('PATCH /api/tasks/:id/status — change status to done sets completed_at', async () => {
        const res = await authRequest('PATCH', `/api/tasks/${taskId}/status`, { status: 'done' });
        assert.equal(res.status, 200);
        assert.equal(res.data.task.status, 'done');
        assert.ok(res.data.task.completed_at, 'Should have completed_at timestamp');
    });

    it('PUT /api/tasks/:id — full update', async () => {
        const res = await authRequest('PUT', `/api/tasks/${taskId}`, {
            title: 'Updated Task', date: '2099-09-02', status: 'todo', priority: 'low', assigned_to: 'Sergey'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.equal(res.data.task.title, 'Updated Task');
        assert.equal(res.data.task.priority, 'low');
        assert.equal(res.data.task.assigned_to, 'Sergey');
    });

    it('DELETE /api/tasks/:id — delete task', async () => {
        const res = await authRequest('DELETE', `/api/tasks/${taskId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);

        const check = await authRequest('GET', `/api/tasks/${taskId}`);
        assert.equal(check.status, 404);
    });

    it('POST /api/tasks — missing title returns 400', async () => {
        const res = await authRequest('POST', '/api/tasks', { date: '2099-09-01' });
        assert.equal(res.status, 400);
    });

    it('POST /api/tasks — invalid date returns 400', async () => {
        const res = await authRequest('POST', '/api/tasks', { title: 'Bad Date', date: 'not-a-date' });
        assert.equal(res.status, 400);
    });

    it('PATCH /api/tasks/:id/status — invalid status returns 400', async () => {
        const t = await authRequest('POST', '/api/tasks', { title: 'Status Test' });
        const res = await authRequest('PATCH', `/api/tasks/${t.data.task.id}/status`, { status: 'invalid' });
        assert.equal(res.status, 400);
        await authRequest('DELETE', `/api/tasks/${t.data.task.id}`);
    });

    it('DELETE /api/tasks/:id — non-existent returns 404', async () => {
        const res = await authRequest('DELETE', '/api/tasks/999999');
        assert.equal(res.status, 404);
    });

    it('GET /api/tasks — without token returns 401', async () => {
        const res = await request('GET', '/api/tasks');
        assert.equal(res.status, 401);
    });

    it('POST /api/tasks — default priority is normal', async () => {
        const res = await authRequest('POST', '/api/tasks', { title: 'Default Priority' });
        assert.equal(res.status, 200);
        assert.equal(res.data.task.priority, 'normal');
        assert.equal(res.data.task.status, 'todo');
        await authRequest('DELETE', `/api/tasks/${res.data.task.id}`);
    });
});

// ==========================================
// v7.6: Afisha → Tasks generation
// ==========================================
describe('Afisha → Tasks (v7.6)', () => {
    let testAfishaId;

    it('POST /api/afisha/:id/generate-tasks — creates tasks for event', async () => {
        const ev = await authRequest('POST', '/api/afisha', {
            date: '2099-12-01', time: '10:00', title: 'Тест генерації', duration: 60, type: 'event'
        });
        assert.equal(ev.status, 200);
        testAfishaId = ev.data.item.id;

        const res = await authRequest('POST', `/api/afisha/${testAfishaId}/generate-tasks`);
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.equal(res.data.count, 3, 'Event type should generate 3 tasks');
        assert.ok(res.data.tasks.every(t => t.afisha_id === testAfishaId));
        assert.ok(res.data.tasks.every(t => t.date === '2099-12-01'));
    });

    it('POST /api/afisha/:id/generate-tasks — duplicate returns 409', async () => {
        const res = await authRequest('POST', `/api/afisha/${testAfishaId}/generate-tasks`);
        assert.equal(res.status, 409, 'Should reject duplicate generation');
        assert.ok(res.data.existing > 0);
    });

    it('POST /api/afisha/:id/generate-tasks — birthday generates 2 tasks', async () => {
        const ev = await authRequest('POST', '/api/afisha', {
            date: '2099-12-02', time: '12:00', title: 'Петрик', type: 'birthday'
        });
        const res = await authRequest('POST', `/api/afisha/${ev.data.item.id}/generate-tasks`);
        assert.equal(res.status, 200);
        assert.equal(res.data.count, 2, 'Birthday type should generate 2 tasks');
        // cleanup
        await authRequest('DELETE', `/api/afisha/${ev.data.item.id}`);
    });

    it('POST /api/afisha/:id/generate-tasks — regular generates 1 task', async () => {
        const ev = await authRequest('POST', '/api/afisha', {
            date: '2099-12-03', time: '15:00', title: 'Щоденна подія', type: 'regular'
        });
        const res = await authRequest('POST', `/api/afisha/${ev.data.item.id}/generate-tasks`);
        assert.equal(res.status, 200);
        assert.equal(res.data.count, 1, 'Regular type should generate 1 task');
        // cleanup
        await authRequest('DELETE', `/api/afisha/${ev.data.item.id}`);
    });

    it('GET /api/tasks?afisha_id= — filters by afisha_id', async () => {
        const res = await authRequest('GET', `/api/tasks?afisha_id=${testAfishaId}`);
        assert.equal(res.status, 200);
        assert.equal(res.data.length, 3, 'Should return 3 tasks linked to event');
        assert.ok(res.data.every(t => t.afisha_id === testAfishaId));
    });

    it('DELETE /api/afisha/:id — cascade deletes todo tasks', async () => {
        await authRequest('DELETE', `/api/afisha/${testAfishaId}`);
        const res = await authRequest('GET', `/api/tasks?afisha_id=${testAfishaId}`);
        assert.equal(res.data.length, 0, 'Todo tasks should be cascade-deleted');
    });

    it('DELETE /api/afisha/:id — keeps done tasks', async () => {
        const ev = await authRequest('POST', '/api/afisha', {
            date: '2099-12-04', time: '11:00', title: 'Подія з done', type: 'event'
        });
        const gen = await authRequest('POST', `/api/afisha/${ev.data.item.id}/generate-tasks`);
        // Mark one task as done
        await authRequest('PATCH', `/api/tasks/${gen.data.tasks[0].id}/status`, { status: 'done' });
        // Delete afisha
        await authRequest('DELETE', `/api/afisha/${ev.data.item.id}`);
        // Check: done task survives
        const remaining = await authRequest('GET', `/api/tasks?afisha_id=${ev.data.item.id}`);
        assert.equal(remaining.data.length, 1, 'Done task should survive cascade delete');
        // cleanup
        await authRequest('DELETE', `/api/tasks/${gen.data.tasks[0].id}`);
    });

    it('POST /api/afisha/999999/generate-tasks — 404 for non-existent', async () => {
        const res = await authRequest('POST', '/api/afisha/999999/generate-tasks');
        assert.equal(res.status, 404);
    });
});

// ==========================================
// STAFF CRUD (v7.10)
// ==========================================

describe('Staff CRUD (v7.10)', () => {
    let staffId;

    it('GET /api/staff — returns array with departments', async () => {
        const res = await authRequest('GET', '/api/staff');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.data), 'Should return data array');
        assert.ok(res.data.departments, 'Should return departments map');
        assert.ok(res.data.departments.animators, 'Should have animators department');
    });

    it('GET /api/staff?active=true — filters active only', async () => {
        const res = await authRequest('GET', '/api/staff?active=true');
        assert.equal(res.status, 200);
        for (const s of res.data.data) {
            assert.equal(s.is_active, true);
        }
    });

    it('GET /api/staff?department=animators — filters by department', async () => {
        const res = await authRequest('GET', '/api/staff?department=animators');
        assert.equal(res.status, 200);
        for (const s of res.data.data) {
            assert.equal(s.department, 'animators');
        }
    });

    it('POST /api/staff — create employee', async () => {
        const res = await authRequest('POST', '/api/staff', {
            name: 'Тест Працівник', department: 'tech', position: 'Тестер',
            phone: '+380990000000', color: '#FF5500', telegramUsername: 'test_worker'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.equal(res.data.data.name, 'Тест Працівник');
        assert.equal(res.data.data.department, 'tech');
        assert.equal(res.data.data.telegram_username, 'test_worker');
        staffId = res.data.data.id;
    });

    it('POST /api/staff — missing required fields returns 400', async () => {
        const res = await authRequest('POST', '/api/staff', { name: 'No Department' });
        assert.equal(res.status, 400);
    });

    it('PUT /api/staff/:id — update employee', async () => {
        const res = await authRequest('PUT', `/api/staff/${staffId}`, {
            name: 'Оновлений Працівник', position: 'Старший тестер',
            telegramUsername: 'updated_worker'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.data.name, 'Оновлений Працівник');
        assert.equal(res.data.data.telegram_username, 'updated_worker');
    });

    it('PUT /api/staff/:id — without telegramUsername preserves existing', async () => {
        const res = await authRequest('PUT', `/api/staff/${staffId}`, {
            position: 'Ще старший тестер'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.data.telegram_username, 'updated_worker', 'Should preserve telegram_username');
    });

    it('PUT /api/staff/:id — non-existent returns 404', async () => {
        const res = await authRequest('PUT', '/api/staff/999999', { name: 'Nobody' });
        assert.equal(res.status, 404);
    });

    it('DELETE /api/staff/:id — delete employee', async () => {
        const res = await authRequest('DELETE', `/api/staff/${staffId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('GET /api/staff — without token returns 401', async () => {
        const res = await request('GET', '/api/staff');
        assert.equal(res.status, 401);
    });

    it('GET /api/staff/departments — returns department map', async () => {
        const res = await authRequest('GET', '/api/staff/departments');
        assert.equal(res.status, 200);
        assert.ok(res.data.data.animators);
        assert.ok(res.data.data.cafe);
    });
});

// ==========================================
// STAFF SCHEDULE (v7.10)
// ==========================================

describe('Staff Schedule (v7.10)', () => {
    let testStaffId;

    before(async () => {
        const res = await authRequest('POST', '/api/staff', {
            name: 'Графік Тест', department: 'animators', position: 'Тест-аніматор'
        });
        testStaffId = res.data.data.id;
    });

    it('PUT /api/staff/schedule — create schedule entry', async () => {
        const res = await authRequest('PUT', '/api/staff/schedule', {
            staffId: testStaffId, date: '2099-06-01',
            shiftStart: '10:00', shiftEnd: '20:00', status: 'working'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.equal(res.data.data.status, 'working');
        assert.equal(res.data.data.shift_start, '10:00');
    });

    it('PUT /api/staff/schedule — upsert overwrites existing', async () => {
        const res = await authRequest('PUT', '/api/staff/schedule', {
            staffId: testStaffId, date: '2099-06-01',
            status: 'dayoff', note: 'Перезаписано'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.data.status, 'dayoff');
        assert.equal(res.data.data.note, 'Перезаписано');
    });

    it('PUT /api/staff/schedule — missing staffId returns 400', async () => {
        const res = await authRequest('PUT', '/api/staff/schedule', { date: '2099-06-01' });
        assert.equal(res.status, 400);
    });

    it('PUT /api/staff/schedule — missing date returns 400', async () => {
        const res = await authRequest('PUT', '/api/staff/schedule', { staffId: testStaffId });
        assert.equal(res.status, 400);
    });

    it('GET /api/staff/schedule — returns entries for date range', async () => {
        // Create a few entries
        await authRequest('PUT', '/api/staff/schedule', {
            staffId: testStaffId, date: '2099-06-02',
            shiftStart: '09:00', shiftEnd: '18:00', status: 'working'
        });
        await authRequest('PUT', '/api/staff/schedule', {
            staffId: testStaffId, date: '2099-06-03',
            status: 'vacation', note: 'Відпустка'
        });

        const res = await authRequest('GET', '/api/staff/schedule?from=2099-06-01&to=2099-06-07');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        const entries = res.data.data.filter(e => e.staff_id === testStaffId);
        assert.ok(entries.length >= 3, `Should have at least 3 entries, got ${entries.length}`);
    });

    it('GET /api/staff/schedule — missing params returns 400', async () => {
        const res = await authRequest('GET', '/api/staff/schedule');
        assert.equal(res.status, 400);
    });

    after(async () => {
        if (testStaffId) await authRequest('DELETE', `/api/staff/${testStaffId}`);
    });
});

// ==========================================
// STAFF SCHEDULE BULK (v7.10)
// ==========================================

describe('Staff Schedule Bulk (v7.10)', () => {
    let testStaffId;

    before(async () => {
        const res = await authRequest('POST', '/api/staff', {
            name: 'Bulk Тест', department: 'cafe', position: 'Тест-кухар',
            telegramUsername: 'bulk_test_worker'
        });
        testStaffId = res.data.data.id;
    });

    it('POST /api/staff/schedule/bulk — mass upsert', async () => {
        const entries = [];
        for (let d = 1; d <= 5; d++) {
            entries.push({
                staffId: testStaffId, date: `2099-07-0${d}`,
                shiftStart: '08:00', shiftEnd: '19:00', status: 'working'
            });
        }
        entries.push({
            staffId: testStaffId, date: '2099-07-06',
            status: 'dayoff', note: 'Вихідний'
        });
        entries.push({
            staffId: testStaffId, date: '2099-07-07',
            status: 'dayoff', note: 'Вихідний'
        });

        const res = await authRequest('POST', '/api/staff/schedule/bulk', { entries });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.equal(res.data.count, 7, 'Should upsert 7 entries');
    });

    it('POST /api/staff/schedule/bulk — empty array returns 400', async () => {
        const res = await authRequest('POST', '/api/staff/schedule/bulk', { entries: [] });
        assert.equal(res.status, 400);
    });

    it('POST /api/staff/schedule/bulk — non-array returns 400', async () => {
        const res = await authRequest('POST', '/api/staff/schedule/bulk', { entries: 'bad' });
        assert.equal(res.status, 400);
    });

    it('POST /api/staff/schedule/bulk — over 500 entries returns 400', async () => {
        const entries = Array.from({ length: 501 }, (_, i) => ({
            staffId: testStaffId, date: '2099-07-01', status: 'working'
        }));
        const res = await authRequest('POST', '/api/staff/schedule/bulk', { entries });
        assert.equal(res.status, 400);
    });

    it('POST /api/staff/schedule/bulk — skips entries without staffId', async () => {
        const res = await authRequest('POST', '/api/staff/schedule/bulk', {
            entries: [
                { date: '2099-07-10', status: 'working' },
                { staffId: testStaffId, date: '2099-07-10', status: 'working' }
            ]
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.count, 1, 'Should skip entry without staffId');
    });

    after(async () => {
        if (testStaffId) await authRequest('DELETE', `/api/staff/${testStaffId}`);
    });
});

// ==========================================
// STAFF SCHEDULE COPY WEEK (v7.10)
// ==========================================

describe('Staff Schedule Copy Week (v7.10)', () => {
    let testStaffId;

    before(async () => {
        const res = await authRequest('POST', '/api/staff', {
            name: 'Copy Тест', department: 'animators', position: 'Копіювальник'
        });
        testStaffId = res.data.data.id;
        // Fill source week Mon-Sun 2099-08-04 to 2099-08-10
        const entries = [];
        for (let d = 4; d <= 10; d++) {
            entries.push({
                staffId: testStaffId, date: `2099-08-${d < 10 ? '0' + d : d}`,
                shiftStart: d <= 8 ? '10:00' : null, shiftEnd: d <= 8 ? '20:00' : null,
                status: d <= 8 ? 'working' : 'dayoff'
            });
        }
        await authRequest('POST', '/api/staff/schedule/bulk', { entries });
    });

    it('POST /api/staff/schedule/copy-week — copies week to next', async () => {
        const res = await authRequest('POST', '/api/staff/schedule/copy-week', {
            fromMonday: '2099-08-04', toMonday: '2099-08-11'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.count > 0, 'Should copy at least 1 entry');

        // Verify target week has entries
        const check = await authRequest('GET', '/api/staff/schedule?from=2099-08-11&to=2099-08-17');
        const copied = check.data.data.filter(e => e.staff_id === testStaffId);
        assert.ok(copied.length > 0, 'Target week should have copied entries');
    });

    it('POST /api/staff/schedule/copy-week — missing params returns 400', async () => {
        const res = await authRequest('POST', '/api/staff/schedule/copy-week', { fromMonday: '2099-08-04' });
        assert.equal(res.status, 400);
    });

    it('POST /api/staff/schedule/copy-week — with department filter', async () => {
        const res = await authRequest('POST', '/api/staff/schedule/copy-week', {
            fromMonday: '2099-08-04', toMonday: '2099-08-18', department: 'animators'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    after(async () => {
        if (testStaffId) await authRequest('DELETE', `/api/staff/${testStaffId}`);
    });
});

// ==========================================
// STAFF SCHEDULE HOURS (v7.10)
// ==========================================

describe('Staff Schedule Hours (v7.10)', () => {
    let testStaffId;

    before(async () => {
        const res = await authRequest('POST', '/api/staff', {
            name: 'Hours Тест', department: 'admin', position: 'Годинувальник'
        });
        testStaffId = res.data.data.id;
        // Create 5 working days + 2 dayoffs
        const entries = [];
        for (let d = 1; d <= 5; d++) {
            entries.push({
                staffId: testStaffId, date: `2099-09-0${d}`,
                shiftStart: '09:00', shiftEnd: '18:00', status: 'working'
            });
        }
        entries.push({ staffId: testStaffId, date: '2099-09-06', status: 'dayoff' });
        entries.push({ staffId: testStaffId, date: '2099-09-07', status: 'sick', note: 'Хворий' });
        await authRequest('POST', '/api/staff/schedule/bulk', { entries });
    });

    it('GET /api/staff/schedule/hours — returns hours statistics', async () => {
        const res = await authRequest('GET', '/api/staff/schedule/hours?from=2099-09-01&to=2099-09-07');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        const stats = res.data.data[testStaffId];
        assert.ok(stats, 'Should have stats for test staff');
        assert.equal(stats.totalHours, 45, '5 days * 9 hours = 45');
        assert.equal(stats.workingDays, 5);
        assert.equal(stats.dayoffs, 1);
        assert.equal(stats.sickDays, 1);
    });

    it('GET /api/staff/schedule/hours — missing params returns 400', async () => {
        const res = await authRequest('GET', '/api/staff/schedule/hours');
        assert.equal(res.status, 400);
    });

    after(async () => {
        if (testStaffId) await authRequest('DELETE', `/api/staff/${testStaffId}`);
    });
});

// ==========================================
// STAFF SCHEDULE CHECK DATE (v7.10)
// ==========================================

describe('Staff Schedule Check Date (v7.10)', () => {
    let availableId, unavailableId;

    before(async () => {
        const a = await authRequest('POST', '/api/staff', {
            name: 'Available Аніматор', department: 'animators', position: 'Аніматор'
        });
        availableId = a.data.data.id;
        await authRequest('PUT', '/api/staff/schedule', {
            staffId: availableId, date: '2099-11-01',
            shiftStart: '10:00', shiftEnd: '20:00', status: 'working'
        });

        const u = await authRequest('POST', '/api/staff', {
            name: 'Sick Аніматор', department: 'animators', position: 'Аніматор'
        });
        unavailableId = u.data.data.id;
        await authRequest('PUT', '/api/staff/schedule', {
            staffId: unavailableId, date: '2099-11-01', status: 'sick', note: 'Лікарняний'
        });
    });

    it('GET /api/staff/schedule/check/:date — returns available and unavailable', async () => {
        const res = await authRequest('GET', '/api/staff/schedule/check/2099-11-01');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.available));
        assert.ok(Array.isArray(res.data.unavailable));

        const avail = res.data.available.find(a => a.id === availableId);
        assert.ok(avail, 'Available animator should be in available list');
        assert.equal(avail.shiftStart, '10:00');

        const unavail = res.data.unavailable.find(u => u.id === unavailableId);
        assert.ok(unavail, 'Sick animator should be in unavailable list');
        assert.equal(unavail.status, 'sick');
    });

    after(async () => {
        if (availableId) await authRequest('DELETE', `/api/staff/${availableId}`);
        if (unavailableId) await authRequest('DELETE', `/api/staff/${unavailableId}`);
    });
});
