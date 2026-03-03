/**
 * tests/staff.test.js — Staff & Schedule API Tests
 * Run: node --test tests/staff.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

// ==========================================
// STAFF CRUD
// ==========================================

describe('Staff CRUD', () => {
    let createdStaffId;

    it('POST /api/staff — create staff member', async () => {
        const res = await authRequest('POST', '/api/staff', {
            name: 'Тест Аніматор Smoke',
            department: 'animators',
            position: 'animator',
            phone: '+380661112233',
            color: '#FF5500'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(res.data.data, 'Should return data');
        assert.ok(res.data.data.id, 'Should have id');
        createdStaffId = res.data.data.id;
    });

    it('POST /api/staff — reject without required fields', async () => {
        const res = await authRequest('POST', '/api/staff', {
            name: 'Missing fields'
            // no department, position
        });
        assert.ok([400, 500].includes(res.status));
    });

    it('GET /api/staff — list all staff', async () => {
        const res = await authRequest('GET', '/api/staff');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.data), 'Should return staff array');
    });

    it('GET /api/staff?department=animators — filter by department', async () => {
        const res = await authRequest('GET', '/api/staff?department=animators');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.data));
    });

    it('GET /api/staff?active=true — filter active only', async () => {
        const res = await authRequest('GET', '/api/staff?active=true');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.data));
    });

    it('PUT /api/staff/:id — update staff member', async () => {
        assert.ok(createdStaffId, 'Need created staff id');
        const res = await authRequest('PUT', `/api/staff/${createdStaffId}`, {
            name: 'Тест Аніматор Оновлено',
            department: 'animators',
            position: 'senior_animator',
            color: '#00FF55'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('DELETE /api/staff/:id — delete staff member', async () => {
        assert.ok(createdStaffId, 'Need created staff id');
        const res = await authRequest('DELETE', `/api/staff/${createdStaffId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});

// ==========================================
// DEPARTMENTS
// ==========================================

describe('Staff Departments', () => {
    it('GET /api/staff/departments — list departments', async () => {
        const res = await authRequest('GET', '/api/staff/departments');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.data, 'Should return department data');
    });
});

// ==========================================
// SCHEDULE
// ==========================================

describe('Staff Schedule', () => {
    let testStaffId;

    before(async () => {
        // Get a staff member to schedule
        const staffRes = await authRequest('GET', '/api/staff?active=true');
        if (staffRes.data.data && staffRes.data.data.length > 0) {
            testStaffId = staffRes.data.data[0].id;
        }
    });

    it('GET /api/staff/schedule?from=...&to=... — get schedule', async () => {
        const res = await authRequest('GET', '/api/staff/schedule?from=2099-01-13&to=2099-01-19');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.data), 'Should return schedule array');
    });

    it('PUT /api/staff/schedule — set schedule entry', async () => {
        if (!testStaffId) return; // skip
        const res = await authRequest('PUT', '/api/staff/schedule', {
            staffId: testStaffId,
            date: '2099-01-15',
            shiftStart: '09:00',
            shiftEnd: '18:00',
            status: 'working'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('PUT /api/staff/schedule — set dayoff', async () => {
        if (!testStaffId) return;
        const res = await authRequest('PUT', '/api/staff/schedule', {
            staffId: testStaffId,
            date: '2099-01-16',
            status: 'dayoff'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('POST /api/staff/schedule/bulk — bulk schedule', async () => {
        if (!testStaffId) return;
        const entries = [
            { staffId: testStaffId, date: '2099-01-17', shiftStart: '10:00', shiftEnd: '19:00', status: 'working' },
            { staffId: testStaffId, date: '2099-01-18', status: 'dayoff' }
        ];
        const res = await authRequest('POST', '/api/staff/schedule/bulk', { entries });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(typeof res.data.count === 'number');
    });

    it('POST /api/staff/schedule/copy-week — copy week', async () => {
        const res = await authRequest('POST', '/api/staff/schedule/copy-week', {
            fromMonday: '2099-01-13',
            toMonday: '2099-01-20'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(typeof res.data.count === 'number');
    });

    it('GET /api/staff/schedule/hours?from=...&to=... — work hours', async () => {
        const res = await authRequest('GET', '/api/staff/schedule/hours?from=2099-01-13&to=2099-01-19');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.data, 'Should return hours data');
    });

    it('GET /api/staff/schedule/check/:date — availability check', async () => {
        const res = await authRequest('GET', '/api/staff/schedule/check/2099-01-15');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.available), 'Should return available array');
        assert.ok(Array.isArray(res.data.unavailable), 'Should return unavailable array');
    });
});
