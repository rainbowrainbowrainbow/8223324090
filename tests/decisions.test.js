/**
 * tests/decisions.test.js — Decision Screen CRUD tests (v36.0.0)
 * Tests create, pending, approve/reject/defer, history
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Decisions CRUD', () => {
    let createdId;

    it('POST /decisions — create decision', async () => {
        const res = await authRequest('POST', '/api/decisions', {
            title: 'Test Decision ' + Date.now(),
            description: 'Test description for automated tests',
            priority: 'normal',
            source: 'system'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.id, 'should return id');
        assert.ok(res.data.ok, 'should return ok');
        createdId = res.data.id;
    });

    it('POST /decisions — requires title', async () => {
        const res = await authRequest('POST', '/api/decisions', {
            description: 'No title'
        });
        assert.equal(res.status, 400);
    });

    it('POST /decisions — with priority', async () => {
        const res = await authRequest('POST', '/api/decisions', {
            title: 'Critical Test ' + Date.now(),
            priority: 'critical'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.id);
    });

    it('GET /decisions/pending — returns pending decisions', async () => {
        const res = await authRequest('GET', '/api/decisions/pending');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.decisions), 'decisions should be array');
        assert.ok(typeof res.data.count === 'number', 'count should be number');
    });

    it('pending decisions are ordered by priority (critical first)', async () => {
        // Create decisions with known priorities
        await authRequest('POST', '/api/decisions', { title: 'Normal ' + Date.now(), priority: 'normal' });
        await authRequest('POST', '/api/decisions', { title: 'Critical ' + Date.now(), priority: 'critical' });

        const res = await authRequest('GET', '/api/decisions/pending');
        assert.equal(res.status, 200);
        assert.ok(res.data.decisions.length >= 2, 'should have at least 2 decisions');

        // Find first critical and first normal
        const firstCritIdx = res.data.decisions.findIndex(d => d.priority === 'critical');
        const lastNormalIdx = res.data.decisions.map(d => d.priority).lastIndexOf('normal');
        if (firstCritIdx !== -1 && lastNormalIdx !== -1) {
            assert.ok(firstCritIdx < lastNormalIdx,
                'critical decisions should appear before normal ones');
        }
    });

    it('PUT /decisions/:id/approve — approve decision', async () => {
        // Create a fresh one to approve
        const create = await authRequest('POST', '/api/decisions', {
            title: 'To Approve ' + Date.now(),
            priority: 'normal'
        });
        assert.equal(create.status, 200);

        const res = await authRequest('PUT', `/api/decisions/${create.data.id}/approve`, {
            note: 'Approved by test'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.status, 'approved');
        assert.ok(res.data.ok);
    });

    it('PUT /decisions/:id/reject — reject decision', async () => {
        const create = await authRequest('POST', '/api/decisions', {
            title: 'To Reject ' + Date.now(),
            priority: 'normal'
        });
        const res = await authRequest('PUT', `/api/decisions/${create.data.id}/reject`, {
            note: 'Rejected by test'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.status, 'rejected');
    });

    it('PUT /decisions/:id/defer — defer decision', async () => {
        const create = await authRequest('POST', '/api/decisions', {
            title: 'To Defer ' + Date.now(),
            priority: 'important'
        });
        const res = await authRequest('PUT', `/api/decisions/${create.data.id}/defer`);
        assert.equal(res.status, 200);
        assert.equal(res.data.status, 'deferred');
    });

    it('cannot approve already-decided decision', async () => {
        const create = await authRequest('POST', '/api/decisions', {
            title: 'Already Decided ' + Date.now()
        });
        await authRequest('PUT', `/api/decisions/${create.data.id}/approve`);
        // Try again
        const res = await authRequest('PUT', `/api/decisions/${create.data.id}/approve`);
        assert.equal(res.status, 404, 'should return 404 for already decided');
    });

    it('invalid action returns 400', async () => {
        const res = await authRequest('PUT', '/api/decisions/1/invalid_action');
        assert.equal(res.status, 400);
    });

    it('GET /decisions/history — returns decided decisions', async () => {
        const res = await authRequest('GET', '/api/decisions/history');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.decisions));
        if (res.data.decisions.length > 0) {
            const d = res.data.decisions[0];
            assert.notEqual(d.status, 'pending', 'history should not include pending');
        }
    });
});
