/**
 * tests/center.test.js — Center (Boss) API Tests
 * Run: node --test tests/center.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Center', () => {

    it('GET /api/center/overview — KPI dashboard', async () => {
        const res = await authRequest('GET', '/api/center/overview');
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.kpi);
        assert.ok(res.data.kpi.today);
        assert.ok(res.data.kpi.week);
        assert.ok(res.data.kpi.month);
    });

    it('GET /api/center/workers — workers list', async () => {
        const res = await authRequest('GET', '/api/center/workers');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.workers));
    });

    it('GET /api/center/prices — price rules', async () => {
        const res = await authRequest('GET', '/api/center/prices');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.prices));
    });

    it('GET /api/center/report — daily report', async () => {
        const res = await authRequest('GET', '/api/center/report');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('GET /api/center/tasks — aggregated tasks', async () => {
        const res = await authRequest('GET', '/api/center/tasks');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.tasks));
    });

    it('GET /api/center/clients — client search', async () => {
        const res = await authRequest('GET', '/api/center/clients');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.clients));
    });

    it('GET /api/center/goals — revenue goals', async () => {
        const res = await authRequest('GET', '/api/center/goals');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('GET /api/center/briefing — weekly briefing', async () => {
        const res = await authRequest('GET', '/api/center/briefing');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.briefing);
        assert.ok(res.data.briefing.period);
        assert.ok(res.data.briefing.bookings);
        assert.ok(res.data.briefing.tasks);
    });

    it('GET /api/center/reconciliation — financial reconciliation', async () => {
        const res = await authRequest('GET', '/api/center/reconciliation');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.reconciliation);
    });

    it('GET /api/center/heatmap — seasonal heatmap', async () => {
        const res = await authRequest('GET', '/api/center/heatmap');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.heatmap));
    });

    it('GET /api/center/program-performance — program matrix', async () => {
        const res = await authRequest('GET', '/api/center/program-performance');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.programs));
    });

    it('GET /api/center/cross-sell — cross-sell insights', async () => {
        const res = await authRequest('GET', '/api/center/cross-sell');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('GET /api/center/event-log — event timeline', async () => {
        const res = await authRequest('GET', '/api/center/event-log');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.events));
    });
});
