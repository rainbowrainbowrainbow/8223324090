/**
 * tests/points.test.js — Points API Tests
 * Run: node --test tests/points.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Points', () => {

    it('GET /api/points — leaderboard', async () => {
        const res = await authRequest('GET', '/api/points');
        assert.equal(res.status, 200);
    });

    it('GET /api/points/admin — own user points', async () => {
        const res = await authRequest('GET', '/api/points/admin');
        assert.equal(res.status, 200);
    });

    it('GET /api/points/admin/history — points history', async () => {
        const res = await authRequest('GET', '/api/points/admin/history');
        assert.equal(res.status, 200);
        assert.ok(res.data.transactions !== undefined, 'Should have transactions');
        assert.ok(typeof res.data.total === 'number', 'Should have total count');
    });

    it('GET /api/points/admin/history?limit=5 — limited history', async () => {
        const res = await authRequest('GET', '/api/points/admin/history?limit=5');
        assert.equal(res.status, 200);
        assert.ok(res.data.transactions.length <= 5);
    });
});
