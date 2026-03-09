/**
 * tests/contractors.test.js — Contractors API Tests
 * Run: node --test tests/contractors.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Contractors', () => {
    let createdId;

    it('POST /api/contractors — create contractor', async () => {
        const res = await authRequest('POST', '/api/contractors', {
            name: 'Smoke Contractor',
            specialty: ['photography'],
            category: 'general',
            phone: '+380991112233'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.contractor);
        createdId = res.data.contractor.id;
    });

    it('POST /api/contractors — reject without name', async () => {
        const res = await authRequest('POST', '/api/contractors', {
            phone: '+380991112233'
        });
        assert.equal(res.status, 400);
    });

    it('GET /api/contractors — list all', async () => {
        const res = await authRequest('GET', '/api/contractors');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/contractors/leaderboard — top contractors', async () => {
        const res = await authRequest('GET', '/api/contractors/leaderboard');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/contractors/overview — dashboard stats', async () => {
        const res = await authRequest('GET', '/api/contractors/overview');
        assert.equal(res.status, 200);
        assert.ok(res.data.contractors);
        assert.ok(res.data.tasks);
    });

    it('GET /api/contractors/:id — single contractor', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('GET', `/api/contractors/${createdId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.name);
    });

    it('PUT /api/contractors/:id — update contractor', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('PUT', `/api/contractors/${createdId}`, {
            name: 'Updated Contractor',
            specialty: ['photography', 'video'],
            category: 'media'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('POST /api/contractors/:id/regenerate-invite — regenerate invite', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('POST', `/api/contractors/${createdId}/regenerate-invite`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.invite_token);
    });

    it('GET /api/contractors/:id/tasks — contractor tasks', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('GET', `/api/contractors/${createdId}/tasks`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/contractors/:id/ratings — contractor ratings', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('GET', `/api/contractors/${createdId}/ratings`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/contractors/:id/escalations — contractor escalations', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('GET', `/api/contractors/${createdId}/escalations`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('DELETE /api/contractors/:id — delete contractor', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('DELETE', `/api/contractors/${createdId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});
