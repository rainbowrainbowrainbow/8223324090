/**
 * tests/event-queue.test.js — Event Queue & Rule Engine API Tests
 * Run: node --test tests/event-queue.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Event Queue', () => {
    let ruleId;

    // ==========================================
    // EVENTS
    // ==========================================

    it('POST /api/events/publish — publish event', async () => {
        const res = await authRequest('POST', '/api/events/publish', {
            event_type: 'smoke.test',
            payload: { message: 'smoke test event' },
            idempotency_key: 'smoke-' + Date.now()
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
    });

    it('POST /api/events/publish — reject without event_type', async () => {
        const res = await authRequest('POST', '/api/events/publish', {
            payload: { test: true }
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/events/publish — idempotency', async () => {
        const key = 'idempotent-' + Date.now();
        await authRequest('POST', '/api/events/publish', {
            event_type: 'smoke.test',
            idempotency_key: key
        });
        const res = await authRequest('POST', '/api/events/publish', {
            event_type: 'smoke.test',
            idempotency_key: key
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.duplicate, 'Second publish should be duplicate');
    });

    it('GET /api/events — list events', async () => {
        const res = await authRequest('GET', '/api/events');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/events/overview — queue dashboard', async () => {
        const res = await authRequest('GET', '/api/events/overview');
        assert.equal(res.status, 200);
        assert.ok(res.data.queue);
        assert.ok(res.data.rules);
    });

    it('GET /api/events/dead-letter — dead letter queue', async () => {
        const res = await authRequest('GET', '/api/events/dead-letter');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    // ==========================================
    // RULES
    // ==========================================

    it('POST /api/events/rules — create rule', async () => {
        const res = await authRequest('POST', '/api/events/rules', {
            code: 'smoke-rule-' + Date.now(),
            name: 'Smoke Rule',
            trigger_event: 'smoke.test',
            conditions: {},
            actions: [{ type: 'log', message: 'smoke triggered' }]
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.rule);
        ruleId = res.data.rule.id;
    });

    it('POST /api/events/rules — reject without required', async () => {
        const res = await authRequest('POST', '/api/events/rules', {
            name: 'No code'
        });
        assert.equal(res.status, 400);
    });

    it('GET /api/events/rules — list rules', async () => {
        const res = await authRequest('GET', '/api/events/rules');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/events/rules/log — execution log', async () => {
        const res = await authRequest('GET', '/api/events/rules/log');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('DELETE /api/events/rules/:id — delete rule', async () => {
        assert.ok(ruleId, 'Need rule id');
        const res = await authRequest('DELETE', `/api/events/rules/${ruleId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});
