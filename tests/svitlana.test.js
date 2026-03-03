/**
 * tests/svitlana.test.js — Svitlana Bot API Tests (secret-based auth)
 * Run: SVITLANA_SECRET=test-secret node --test tests/svitlana.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { BASE_URL, testDate } = require('./helpers');

const SVITLANA_SECRET = process.env.SVITLANA_SECRET || '';

async function svitlanaRequest(method, path, body) {
    const headers = { 'x-svitlana-secret': SVITLANA_SECRET };
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
}

describe('Svitlana', () => {

    it('GET /api/svitlana/tasks — reject without secret', async () => {
        const res = await fetch(`${BASE_URL}/api/svitlana/tasks`);
        const data = await res.json().catch(() => null);
        assert.ok([401, 503].includes(res.status), `Expected 401 or 503, got ${res.status}`);
    });

    // Skip remaining tests if secret not configured
    const skip = !SVITLANA_SECRET;

    it('GET /api/svitlana/tasks — list tasks', { skip }, async () => {
        const res = await svitlanaRequest('GET', `/api/svitlana/tasks?date=${testDate()}`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/svitlana/shifts — list shifts', { skip }, async () => {
        const res = await svitlanaRequest('GET', `/api/svitlana/shifts?date=${testDate()}`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('POST /api/svitlana/tasks — create task', { skip }, async () => {
        const res = await svitlanaRequest('POST', '/api/svitlana/tasks', {
            title: 'Smoke Svitlana Task',
            date: testDate(),
            priority: 'normal'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('POST /api/svitlana/tasks — reject without title', { skip }, async () => {
        const res = await svitlanaRequest('POST', '/api/svitlana/tasks', {
            date: testDate()
        });
        assert.equal(res.status, 400);
    });
});
