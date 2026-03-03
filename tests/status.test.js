/**
 * tests/status.test.js — Status Page API Tests
 * Run: node --test tests/status.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest, publicRequest } = require('./helpers');

describe('Status', () => {
    let incidentId;

    it('GET /api/status/public — public status (no auth)', async () => {
        const res = await publicRequest('GET', '/api/status/public');
        assert.equal(res.status, 200);
        assert.ok(res.data.overall_status);
        assert.ok(Array.isArray(res.data.components));
        assert.ok(Array.isArray(res.data.incidents));
    });

    it('GET /api/status/components — list components', async () => {
        const res = await authRequest('GET', '/api/status/components');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('POST /api/status/incidents — create incident', async () => {
        const res = await authRequest('POST', '/api/status/incidents', {
            title: 'Smoke Test Incident',
            description: 'Test incident',
            severity: 'minor'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.incident);
        incidentId = res.data.incident.id;
    });

    it('POST /api/status/incidents — reject without title', async () => {
        const res = await authRequest('POST', '/api/status/incidents', {
            severity: 'minor'
        });
        assert.equal(res.status, 400);
    });

    it('GET /api/status/incidents — list incidents', async () => {
        const res = await authRequest('GET', '/api/status/incidents');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('POST /api/status/incidents/:id/update — add update', async () => {
        assert.ok(incidentId, 'Need incident id');
        const res = await authRequest('POST', `/api/status/incidents/${incidentId}/update`, {
            status: 'resolved',
            message: 'Fixed by smoke test'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('POST /api/status/incidents/:id/update — reject invalid status', async () => {
        assert.ok(incidentId, 'Need incident id');
        const res = await authRequest('POST', `/api/status/incidents/${incidentId}/update`, {
            status: 'invalid_status',
            message: 'test'
        });
        assert.equal(res.status, 400);
    });
});
