/**
 * tests/analytics.test.js — Analytics API Tests
 * Run: node --test tests/analytics.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Analytics', () => {
    it('GET /api/analytics/overview — default period', async () => {
        const res = await authRequest('GET', '/api/analytics/overview?from=2099-01-01&to=2099-01-31');
        assert.equal(res.status, 200);
        assert.ok(res.data.bookings, 'Should have bookings section');
        assert.ok(res.data.finance, 'Should have finance section');
    });

    it('GET /api/analytics/overview?period=month — monthly', async () => {
        const res = await authRequest('GET', '/api/analytics/overview?period=month');
        assert.equal(res.status, 200);
        assert.ok(res.data.period);
    });

    it('GET /api/analytics/overview?period=week — weekly', async () => {
        const res = await authRequest('GET', '/api/analytics/overview?period=week');
        assert.equal(res.status, 200);
    });

    it('GET /api/analytics/charts — chart data', async () => {
        const res = await authRequest('GET', '/api/analytics/charts?from=2099-01-01&to=2099-01-31');
        assert.equal(res.status, 200);
        assert.ok(res.data.period, 'Should have period');
    });

    it('GET /api/analytics/comparison — period comparison', async () => {
        const res = await authRequest('GET', '/api/analytics/comparison?from=2099-01-01&to=2099-01-31');
        assert.equal(res.status, 200);
        assert.ok(res.data.current, 'Should have current period');
        assert.ok(res.data.previous, 'Should have previous period');
        assert.ok(Array.isArray(res.data.metrics), 'Should have metrics array');
    });

    it('GET /api/analytics/conversion — manager conversion', async () => {
        const res = await authRequest('GET', '/api/analytics/conversion?period=month');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.managers), 'Should have managers array');
    });
});
