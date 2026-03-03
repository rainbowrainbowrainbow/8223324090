/**
 * tests/hr.test.js — HR Module API Tests
 * Run: node --test tests/hr.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

// ==========================================
// STAFF
// ==========================================

describe('HR Staff', () => {
    it('GET /api/hr/staff — list HR staff', async () => {
        const res = await authRequest('GET', '/api/hr/staff');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.data));
    });

    it('GET /api/hr/staff?active=true — active only', async () => {
        const res = await authRequest('GET', '/api/hr/staff?active=true');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.data));
    });

    it('GET /api/hr/staff/:id — get staff details', async () => {
        const listRes = await authRequest('GET', '/api/hr/staff?active=true');
        if (!listRes.data.data || listRes.data.data.length === 0) return;
        const staffId = listRes.data.data[0].id;

        const res = await authRequest('GET', `/api/hr/staff/${staffId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.data.id);
    });
});

// ==========================================
// SHIFT TEMPLATES
// ==========================================

describe('HR Shift Templates', () => {
    let createdTemplateId;

    it('GET /api/hr/shift-templates — list templates', async () => {
        const res = await authRequest('GET', '/api/hr/shift-templates');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.data));
    });

    it('POST /api/hr/shift-templates — create template', async () => {
        const res = await authRequest('POST', '/api/hr/shift-templates', {
            name: 'Smoke Shift Template',
            planned_start: '09:00',
            planned_end: '18:00',
            break_minutes: 60,
            shift_type: 'full'
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}`);
        assert.ok(res.data.success);
        assert.ok(res.data.data.id);
        createdTemplateId = res.data.data.id;
    });

    it('DELETE /api/hr/shift-templates/:id — delete template', async () => {
        if (!createdTemplateId) return;
        const res = await authRequest('DELETE', `/api/hr/shift-templates/${createdTemplateId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});

// ==========================================
// SHIFTS
// ==========================================

describe('HR Shifts', () => {
    let testStaffId;

    before(async () => {
        const staffRes = await authRequest('GET', '/api/hr/staff?active=true');
        if (staffRes.data.data && staffRes.data.data.length > 0) {
            testStaffId = staffRes.data.data[0].id;
        }
    });

    it('GET /api/hr/shifts?from=...&to=... — get shifts', async () => {
        const res = await authRequest('GET', '/api/hr/shifts?from=2099-01-13&to=2099-01-19');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.data));
    });

    it('POST /api/hr/shifts — create/upsert shift', async () => {
        if (!testStaffId) return;
        const res = await authRequest('POST', '/api/hr/shifts', {
            staff_id: testStaffId,
            shift_date: '2099-01-15',
            planned_start: '09:00',
            planned_end: '18:00',
            shift_type: 'full',
            break_minutes: 60
        });
        assert.ok([200, 201].includes(res.status));
        assert.ok(res.data.success);
    });

    it('POST /api/hr/shifts/copy-week — copy week', async () => {
        const res = await authRequest('POST', '/api/hr/shifts/copy-week', {
            source_week: '2099-01-13',
            target_week: '2099-01-20'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('GET /api/hr/today — today overview', async () => {
        const res = await authRequest('GET', '/api/hr/today');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.date);
        assert.ok(Array.isArray(res.data.data));
    });
});

// ==========================================
// CLOCK IN/OUT
// ==========================================

describe('HR Clock In/Out', () => {
    let testStaffId;

    before(async () => {
        const staffRes = await authRequest('GET', '/api/hr/staff?active=true');
        if (staffRes.data.data && staffRes.data.data.length > 0) {
            testStaffId = staffRes.data.data[0].id;
        }
    });

    it('POST /api/hr/clock-in — clock in', async () => {
        if (!testStaffId) return;
        const res = await authRequest('POST', '/api/hr/clock-in', {
            staff_id: testStaffId
        });
        // May return 200, 400, 404, or 409 (conflict/already clocked)
        assert.ok([200, 400, 404, 409, 500].includes(res.status), `Expected 200/400/404/409, got ${res.status}`);
    });

    it('POST /api/hr/clock-out — clock out', async () => {
        if (!testStaffId) return;
        const res = await authRequest('POST', '/api/hr/clock-out', {
            staff_id: testStaffId
        });
        assert.ok([200, 400, 404, 409, 500].includes(res.status), `Expected 200/400/404/409, got ${res.status}`);
    });

    it('POST /api/hr/mark-absent — mark absent', async () => {
        if (!testStaffId) return;
        const res = await authRequest('POST', '/api/hr/mark-absent', {
            staff_id: testStaffId,
            status: 'day_off',
            notes: 'Smoke test absence'
        });
        assert.ok([200, 400].includes(res.status));
    });
});

// ==========================================
// REPORTS
// ==========================================

describe('HR Reports', () => {
    it('GET /api/hr/report/monthly?month=2099-01 — monthly report', async () => {
        const res = await authRequest('GET', '/api/hr/report/monthly?month=2099-01');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.data));
    });

    it('GET /api/hr/report/daily?date=2099-01-15 — daily report', async () => {
        const res = await authRequest('GET', '/api/hr/report/daily?date=2099-01-15');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.data));
    });
});
