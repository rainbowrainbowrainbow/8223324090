/**
 * tests/training.test.js — Training Module API Tests
 * Run: node --test tests/training.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Training', () => {
    it('GET /api/training/materials — list materials', async () => {
        const res = await authRequest('GET', '/api/training/materials?page=1&limit=10');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.materials), 'Should return materials array');
        assert.ok(typeof res.data.total === 'number');
    });

    it('GET /api/training/materials?category=soft_skills — filter by category', async () => {
        const res = await authRequest('GET', '/api/training/materials?category=soft_skills');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.materials));
    });

    it('GET /api/training/stats — training stats', async () => {
        const res = await authRequest('GET', '/api/training/stats');
        assert.equal(res.status, 200);
        assert.ok(typeof res.data.totalMaterials === 'number');
        assert.ok(typeof res.data.thisWeekInputs === 'number');
    });

    it('GET /api/training/weekly-pending — pending reviews', async () => {
        const res = await authRequest('GET', '/api/training/weekly-pending');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.inputs));
    });

    it('POST /api/training/submit — submit training input', async () => {
        const res = await authRequest('POST', '/api/training/submit', {
            staff_id: 1,
            telegram_id: 12345,
            content: 'Smoke test training input: learned new greeting technique'
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}`);
        assert.ok(res.data.success);
    });
});
