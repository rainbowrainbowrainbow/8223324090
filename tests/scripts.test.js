/**
 * tests/scripts.test.js — Sales Scripts API Tests
 * Run: node --test tests/scripts.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Sales Scripts', () => {
    let createdId;

    it('GET /api/scripts — list scripts', async () => {
        const res = await authRequest('GET', '/api/scripts');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.scripts));
    });

    it('POST /api/scripts — create script', async () => {
        const res = await authRequest('POST', '/api/scripts', {
            category: 'greeting',
            response_text: 'Привіт! Ласкаво просимо до парку!',
            trigger_phrase: 'вітання'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.script);
        createdId = res.data.script.id;
    });

    it('POST /api/scripts — reject without required fields', async () => {
        const res = await authRequest('POST', '/api/scripts', {
            category: 'greeting'
        });
        assert.equal(res.status, 400);
    });

    it('PUT /api/scripts/:id — update script', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('PUT', `/api/scripts/${createdId}`, {
            response_text: 'Оновлений скрипт!'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('DELETE /api/scripts/:id — delete script', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('DELETE', `/api/scripts/${createdId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('DELETE /api/scripts/99999 — non-existent', async () => {
        const res = await authRequest('DELETE', '/api/scripts/99999');
        assert.equal(res.status, 404);
    });
});
