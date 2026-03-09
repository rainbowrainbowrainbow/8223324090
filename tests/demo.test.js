/**
 * tests/demo.test.js — Demo Mode API Tests
 * Run: node --test tests/demo.test.js
 *
 * Note: Scenario CRUD and toggle require role='admin' (test user is 'creator'),
 * so we test read endpoints + auth rejection on write endpoints.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Demo', () => {

    // ==========================================
    // READ (public / any auth)
    // ==========================================

    it('GET /api/demo/scenarios — list scenarios', async () => {
        const res = await authRequest('GET', '/api/demo/scenarios');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.scenarios));
    });

    it('GET /api/demo/scenarios?category=test — filter by category', async () => {
        const res = await authRequest('GET', '/api/demo/scenarios?category=test');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('GET /api/demo/overview — demo dashboard', async () => {
        const res = await authRequest('GET', '/api/demo/overview');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(typeof res.data.scenarioCount === 'number');
    });

    // ==========================================
    // ADMIN-ONLY (requires role='admin', test user is 'creator' → 403)
    // ==========================================

    it('POST /api/demo/scenarios — requires admin (403)', async () => {
        const res = await authRequest('POST', '/api/demo/scenarios', {
            code: 'smoke-test',
            title: 'Smoke Scenario',
            category: 'test'
        });
        assert.equal(res.status, 403, 'Should reject non-admin');
    });

    it('POST /api/demo/toggle — toggle demo mode', async () => {
        const res = await authRequest('POST', '/api/demo/toggle', { enabled: false });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    // ==========================================
    // SESSIONS
    // ==========================================

    it('POST /api/demo/sessions — reject without scenario_id', async () => {
        const res = await authRequest('POST', '/api/demo/sessions', {
            user_name: 'Smoke Tester'
        });
        assert.equal(res.status, 400);
    });
});
