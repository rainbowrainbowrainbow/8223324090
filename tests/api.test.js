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
// HISTORY
// ==========================================

describe('History', () => {
    it('GET /api/history — should return array', async () => {
        const res = await authRequest('GET', '/api/history');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
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
});
