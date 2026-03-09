/**
 * tests/employees.test.js — Employees API Tests
 * Run: node --test tests/employees.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Employees', () => {
    let createdId;

    it('POST /api/employees — create employee profile', async () => {
        const res = await authRequest('POST', '/api/employees', {
            full_name: 'Тест Працівник',
            email: 'test@smoke.com',
            phone: '+380991234567',
            role: 'employee',
            department: 'animators'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.employee);
        createdId = res.data.employee.id;
    });

    it('POST /api/employees — reject without full_name', async () => {
        const res = await authRequest('POST', '/api/employees', {
            email: 'no-name@test.com'
        });
        assert.equal(res.status, 400);
    });

    it('GET /api/employees — list all', async () => {
        const res = await authRequest('GET', '/api/employees');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/employees?department=animators — filter by department', async () => {
        const res = await authRequest('GET', '/api/employees?department=animators');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/employees/overview — mapping stats', async () => {
        const res = await authRequest('GET', '/api/employees/overview');
        assert.equal(res.status, 200);
        assert.ok(res.data.profiles, 'Should return profiles stats');
    });

    it('GET /api/employees/:id — single profile', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('GET', `/api/employees/${createdId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.full_name);
    });

    it('GET /api/employees/99999 — non-existent', async () => {
        const res = await authRequest('GET', '/api/employees/99999');
        assert.equal(res.status, 404);
    });

    it('PUT /api/employees/:id — update profile', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('PUT', `/api/employees/${createdId}`, {
            full_name: 'Оновлений Працівник',
            department: 'management'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('POST /api/employees/auto-link — auto-create profiles', async () => {
        const res = await authRequest('POST', '/api/employees/auto-link');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(typeof res.data.created === 'number');
    });
});
