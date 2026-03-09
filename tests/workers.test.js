/**
 * tests/workers.test.js — Digital Workers API Tests
 * Run: node --test tests/workers.test.js
 *
 * Note: POST/PUT/DELETE require role='admin' (test user is 'creator'),
 * so we test read + auth rejection.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Workers', () => {

    it('GET /api/workers — list all workers', async () => {
        const res = await authRequest('GET', '/api/workers');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/workers?active=true — filter active', async () => {
        const res = await authRequest('GET', '/api/workers?active=true');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('POST /api/workers — requires admin role (403 for creator)', async () => {
        const res = await authRequest('POST', '/api/workers', {
            name: 'smoke-worker',
            display_name: 'Smoke Worker',
            purpose: 'Test'
        });
        assert.equal(res.status, 403, 'Should reject non-admin');
    });

    it('PUT /api/workers/1 — requires admin role (403 for creator)', async () => {
        const res = await authRequest('PUT', '/api/workers/1', {
            display_name: 'Update'
        });
        assert.equal(res.status, 403);
    });

    it('DELETE /api/workers/1 — requires admin role (403 for creator)', async () => {
        const res = await authRequest('DELETE', '/api/workers/1');
        assert.equal(res.status, 403);
    });
});
