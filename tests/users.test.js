/**
 * tests/users.test.js — Users Management API Tests
 * Run: node --test tests/users.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Users', () => {
    let createdUserId;

    it('GET /api/users — list all users', async () => {
        const res = await authRequest('GET', '/api/users');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return users array');
        assert.ok(res.data.length > 0, 'Should have at least one user');
    });

    it('GET /api/users/roles — get role hierarchy', async () => {
        const res = await authRequest('GET', '/api/users/roles');
        assert.equal(res.status, 200);
        assert.ok(res.data.hierarchy, 'Should return hierarchy');
        assert.ok(res.data.pageAccess, 'Should return page access');
    });

    it('POST /api/users — create user', async () => {
        const res = await authRequest('POST', '/api/users', {
            username: 'smoketest_user_' + Date.now(),
            password: 'SmokeTest123!',
            name: 'Тест Юзер',
            role: 'animator'
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.user);
        createdUserId = res.data.user.id;
    });

    it('PATCH /api/users/:id/role — change role', async () => {
        if (!createdUserId) return;
        const res = await authRequest('PATCH', `/api/users/${createdUserId}/role`, {
            role: 'manager'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
    });

    it('POST /api/users/:id/reset-password — reset password', async () => {
        if (!createdUserId) return;
        const res = await authRequest('POST', `/api/users/${createdUserId}/reset-password`, {
            newPassword: 'NewPassword456!'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.equal(res.data.login, res.data.username);
        assert.ok(res.data.passwordChangedAt);
    });

    it('POST /api/users/:id/reset-password — accepts legacy manual password payload', async () => {
        if (!createdUserId) return;
        const res = await authRequest('POST', `/api/users/${createdUserId}/reset-password`, {
            password: 'LegacyPayload789!'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.equal(res.data.credential, null);
    });

    it('PATCH /api/users/:id/active — deactivate user', async () => {
        if (!createdUserId) return;
        const res = await authRequest('PATCH', `/api/users/${createdUserId}/active`, {
            isActive: false
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('PATCH /api/users/:id/active — reactivate user', async () => {
        if (!createdUserId) return;
        const res = await authRequest('PATCH', `/api/users/${createdUserId}/active`, {
            isActive: true
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});
